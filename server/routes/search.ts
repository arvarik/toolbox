import { Router } from "express";
import db from "../db.ts";
import { resolveKitById } from "../kits/kitContext.ts";
import { asyncHandler, NotFoundError } from "../platform/net/errors.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import {
  hybridSearch,
  syncDomainSourcesToRag,
  type RagChunkKind,
} from "../search/hybridSearch.ts";
import logger from "../utils/logger.ts";

const router = Router();

const VALID_KINDS = new Set<RagChunkKind>([
  "guide",
  "flashcard",
  "source_chunk",
  "episodic",
]);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const {
      q,
      kitId: rawKitId,
      kit: rawKitParam,
      kinds: rawKinds,
      limit: rawLimit,
    } = req.query;

    if (!q || typeof q !== "string" || q.trim() === "") {
      res.json({
        flashcards: [],
        guideContent: [],
        boards: [],
        decks: [],
        chunks: [],
      });
      return;
    }

    const trimmed = q.trim();
    const headerVal = req.headers["x-toolbox-kit"];
    const headerSlug = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    const rawSelector =
      typeof rawKitId === "string" && rawKitId.trim()
        ? rawKitId.trim()
        : typeof rawKitParam === "string" && rawKitParam.trim()
          ? rawKitParam.trim()
          : typeof headerSlug === "string" && headerSlug.trim()
            ? headerSlug.trim()
            : undefined;

    let kitId: string | undefined;
    if (
      rawSelector &&
      rawSelector.toLowerCase() !== "all" &&
      rawSelector !== "*"
    ) {
      const resolved = resolveKitById(db, scope, rawSelector);
      if (!resolved) {
        throw new NotFoundError("Kit", rawSelector);
      }
      kitId = resolved.id;
    }

    const kinds =
      typeof rawKinds === "string" && rawKinds.trim()
        ? rawKinds
            .split(",")
            .map((s) => s.trim() as RagChunkKind)
            .filter((k) => VALID_KINDS.has(k))
        : undefined;
    const parsedLimit = Number(rawLimit);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit >= 1
        ? Math.min(Math.floor(parsedLimit), 50)
        : 10;

  try {
    await syncDomainSourcesToRag(db, scope, kitId);
    const chunks = await hybridSearch(db, scope, trimmed, {
      kitId,
      kinds,
      limit,
    });

    const likePattern = `%${trimmed}%`;

    // Hydrate hybrid flashcard hits first, then supplement with substring LIKE matches
    const cardIdsFromHybrid = chunks
      .filter((c) => c.kind === "flashcard")
      .map((c) => c.sourceRefId);

    const flashcardsMap = new Map<string, Record<string, unknown>>();
    if (cardIdsFromHybrid.length > 0) {
      const ph = cardIdsFromHybrid.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT id, deck_id, front, back, state
           FROM flashcards
           WHERE ownerId = ? AND id IN (${ph})`,
        )
        .all(scope.ownerId, ...cardIdsFromHybrid) as Array<
        Record<string, unknown>
      >;
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      for (const id of cardIdsFromHybrid) {
        const row = byId.get(id);
        if (row) flashcardsMap.set(id, row);
      }
    }

    const likeCards = (
      kitId
        ? db
            .prepare(
              `SELECT f.id, f.deck_id, f.front, f.back, f.state
               FROM flashcards f
               JOIN decks d ON d.id = f.deck_id AND d.ownerId = f.ownerId
               WHERE f.ownerId = ? AND d.kit_id = ? AND (f.front LIKE ? OR f.back LIKE ?)
               LIMIT 10`,
            )
            .all(scope.ownerId, kitId, likePattern, likePattern)
        : db
            .prepare(
              `SELECT id, deck_id, front, back, state
               FROM flashcards
               WHERE ownerId = ? AND (front LIKE ? OR back LIKE ?)
               LIMIT 10`,
            )
            .all(scope.ownerId, likePattern, likePattern)
    ) as Array<Record<string, unknown>>;

    for (const c of likeCards) {
      const id = String(c.id);
      if (!flashcardsMap.has(id) && flashcardsMap.size < 10) {
        flashcardsMap.set(id, c);
      }
    }

    // Hydrate hybrid guide hits first, then supplement with substring LIKE matches
    const guideMap = new Map<string, Record<string, unknown>>();
    const getGuideStmt = db.prepare(
      `SELECT pillar_id, topic_id, section_id, content
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ? AND content != ''`,
    );
    for (const chunk of chunks) {
      if (chunk.kind !== "guide") continue;
      const [pillar_id, topic_id, section_id] = chunk.sourceRefId.split(":");
      if (!pillar_id || !topic_id || !section_id) continue;
      const row = getGuideStmt.get(
        scope.ownerId,
        chunk.kitId,
        pillar_id,
        topic_id,
        section_id,
      ) as Record<string, unknown> | undefined;
      if (row) guideMap.set(`${chunk.kitId}:${chunk.sourceRefId}`, row);
    }

    const likeGuides = (
      kitId
        ? db
            .prepare(
              `SELECT kit_id, pillar_id, topic_id, section_id, content
               FROM guide_content
               WHERE ownerId = ? AND kit_id = ? AND content != '' AND (content LIKE ? OR section_id LIKE ? OR topic_id LIKE ?)
               LIMIT 10`,
            )
            .all(scope.ownerId, kitId, likePattern, likePattern, likePattern)
        : db
            .prepare(
              `SELECT kit_id, pillar_id, topic_id, section_id, content
               FROM guide_content
               WHERE ownerId = ? AND content != '' AND (content LIKE ? OR section_id LIKE ? OR topic_id LIKE ?)
               LIMIT 10`,
            )
            .all(scope.ownerId, likePattern, likePattern, likePattern)
    ) as Array<Record<string, unknown>>;

    for (const g of likeGuides) {
      const key = `${g.kit_id}:${g.pillar_id}:${g.topic_id}:${g.section_id}`;
      if (!guideMap.has(key) && guideMap.size < 10) {
        guideMap.set(key, {
          pillar_id: g.pillar_id,
          topic_id: g.topic_id,
          section_id: g.section_id,
          content: g.content,
        });
      }
    }

    const boards = kitId
      ? db
          .prepare(
            `SELECT id, name
             FROM boards
             WHERE ownerId = ? AND kit_id = ? AND name LIKE ?
             LIMIT 10`,
          )
          .all(scope.ownerId, kitId, likePattern)
      : db
          .prepare(
            `SELECT id, name
             FROM boards
             WHERE ownerId = ? AND name LIKE ?
             LIMIT 10`,
          )
          .all(scope.ownerId, likePattern);

    const decks = kitId
      ? db
          .prepare(
            `SELECT id, name, description, tags
             FROM decks
             WHERE ownerId = ? AND kit_id = ? AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)
             LIMIT 10`,
          )
          .all(scope.ownerId, kitId, likePattern, likePattern, likePattern)
      : db
          .prepare(
            `SELECT id, name, description, tags
             FROM decks
             WHERE ownerId = ? AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)
             LIMIT 10`,
          )
          .all(scope.ownerId, likePattern, likePattern, likePattern);

    res.json({
      flashcards: [...flashcardsMap.values()],
      guideContent: [...guideMap.values()],
      boards,
      decks,
      chunks,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[search] Error running global search:", msg);
    res.status(500).json({ message: "Failed to run global search" });
  }
  }),
);

export default router;
