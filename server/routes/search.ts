import { Router } from "express";
import db from "../db.ts";
import { resolveKitById } from "../kits/kitContext.ts";
import { asyncHandler, NotFoundError, ValidationError } from "../platform/net/errors.ts";
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
const MAX_SEARCH_QUERY_LEN = 500;

function escapeLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

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
    if (trimmed.length > MAX_SEARCH_QUERY_LEN) {
      throw new ValidationError(
        `Search query must be ${MAX_SEARCH_QUERY_LEN} characters or fewer`,
      );
    }
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

    let limit = 10;
    if (rawLimit !== undefined && rawLimit !== "") {
      if (typeof rawLimit !== "string") {
        throw new ValidationError("limit must be a positive integer");
      }
      const parsedLimit = Number(rawLimit.trim());
      if (!Number.isFinite(parsedLimit) || !Number.isInteger(parsedLimit) || parsedLimit < 1) {
        throw new ValidationError("limit must be a positive integer");
      }
      limit = Math.min(parsedLimit, 50);
    }

  try {
    await syncDomainSourcesToRag(db, scope, kitId);
    const chunks = await hybridSearch(db, scope, trimmed, {
      kitId,
      kinds,
      limit,
    });

    const likePattern = escapeLikePattern(trimmed);
    const k = kitId ?? null;

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

    const likeCards = db
      .prepare(
        `SELECT f.id, f.deck_id, f.front, f.back, f.state
         FROM flashcards f
         LEFT JOIN decks d ON d.id = f.deck_id AND d.ownerId = f.ownerId
         WHERE f.ownerId = ? AND (? IS NULL OR d.kit_id = ?)
           AND (f.front LIKE ? ESCAPE '\\' OR f.back LIKE ? ESCAPE '\\')
         LIMIT 10`,
      )
      .all(scope.ownerId, k, k, likePattern, likePattern) as Array<
      Record<string, unknown>
    >;

    for (const c of likeCards) {
      const id = String(c.id);
      if (!flashcardsMap.has(id) && flashcardsMap.size < 10) {
        flashcardsMap.set(id, c);
      }
    }

    // Hydrate hybrid guide hits in one batched query, then supplement with substring LIKE matches
    const guideMap = new Map<string, Record<string, unknown>>();
    const guideRefs: Array<{
      key: string;
      kitId: string;
      pillarId: string;
      topicId: string;
      sectionId: string;
    }> = [];
    for (const chunk of chunks) {
      if (chunk.kind !== "guide") continue;
      const parts = chunk.sourceRefId.split(":");
      if (parts.length < 3) continue;
      const [pillar_id, topic_id, ...rest] = parts;
      const section_id = rest.join(":");
      if (!pillar_id || !topic_id || !section_id) continue;
      guideRefs.push({
        key: `${chunk.kitId}:${chunk.sourceRefId}`,
        kitId: chunk.kitId,
        pillarId: pillar_id,
        topicId: topic_id,
        sectionId: section_id,
      });
    }
    if (guideRefs.length > 0) {
      const tupleConds = guideRefs
        .map(() => "(kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?)")
        .join(" OR ");
      const tupleParams: string[] = [];
      for (const g of guideRefs) {
        tupleParams.push(g.kitId, g.pillarId, g.topicId, g.sectionId);
      }
      const guideRows = db
        .prepare(
          `SELECT kit_id, pillar_id, topic_id, section_id, content
           FROM guide_content
           WHERE ownerId = ? AND content != '' AND (${tupleConds})`,
        )
        .all(scope.ownerId, ...tupleParams) as Array<Record<string, unknown>>;
      const bySlot = new Map(
        guideRows.map((r) => [
          `${r.kit_id}:${r.pillar_id}:${r.topic_id}:${r.section_id}`,
          {
            pillar_id: r.pillar_id,
            topic_id: r.topic_id,
            section_id: r.section_id,
            content: r.content,
          },
        ]),
      );
      for (const ref of guideRefs) {
        const hit = bySlot.get(ref.key);
        if (hit) guideMap.set(ref.key, hit);
      }
    }

    const likeGuides = db
      .prepare(
        `SELECT kit_id, pillar_id, topic_id, section_id, content
         FROM guide_content
         WHERE ownerId = ? AND (? IS NULL OR kit_id = ?) AND content != ''
           AND (content LIKE ? ESCAPE '\\' OR section_id LIKE ? ESCAPE '\\' OR topic_id LIKE ? ESCAPE '\\')
         LIMIT 10`,
      )
      .all(scope.ownerId, k, k, likePattern, likePattern, likePattern) as Array<
      Record<string, unknown>
    >;

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

    const boards = db
      .prepare(
        `SELECT id, name
         FROM boards
         WHERE ownerId = ? AND (? IS NULL OR kit_id = ?) AND name LIKE ? ESCAPE '\\'
         LIMIT 10`,
      )
      .all(scope.ownerId, k, k, likePattern);

    const decks = db
      .prepare(
        `SELECT id, name, description, tags
         FROM decks
         WHERE ownerId = ? AND (? IS NULL OR kit_id = ?)
           AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
         LIMIT 10`,
      )
      .all(scope.ownerId, k, k, likePattern, likePattern, likePattern);

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
