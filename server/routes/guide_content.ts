import crypto from "node:crypto";
import { Router } from "express";
import db from "../db.ts";
import { asyncHandler, NotFoundError, ValidationError } from "../platform/net/errors.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { resolveActiveKit } from "../kits/kitContext.ts";
import {
  deleteRagChunksBySource,
  upsertRagChunk,
} from "../search/hybridSearch.ts";
import logger from "../utils/logger.ts";

const router = Router();

const VALID_HIGHLIGHT_COLORS = new Set(["amber", "sage", "coral"]);
const MAX_REF_ID_LEN = 200;
const MAX_GUIDE_CONTENT_LEN = 200_000;

function requireValidSlotRef(
  pillarId: unknown,
  topicId: unknown,
  sectionId: unknown = "",
  requireSection = false,
): { pillarId: string; topicId: string; sectionId: string } {
  if (
    typeof pillarId !== "string" ||
    !pillarId.trim() ||
    pillarId.trim().length > MAX_REF_ID_LEN ||
    typeof topicId !== "string" ||
    !topicId.trim() ||
    topicId.trim().length > MAX_REF_ID_LEN
  ) {
    throw new ValidationError("Valid pillarId and topicId are required");
  }
  if (sectionId !== undefined && typeof sectionId !== "string") {
    throw new ValidationError("sectionId must be a string");
  }
  const sec = typeof sectionId === "string" ? sectionId.trim() : "";
  if ((requireSection && !sec) || sec.length > MAX_REF_ID_LEN) {
    throw new ValidationError("Valid sectionId is required");
  }
  return { pillarId: pillarId.trim(), topicId: topicId.trim(), sectionId: sec };
}

function verifyKitOwnedCardId(ownerId: string, kitId: string, cardId: string): string {
  const ownedCard = db
    .prepare(
      `SELECT f.id FROM flashcards f
       JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
       WHERE f.ownerId = ? AND d.kit_id = ? AND f.id = ?`,
    )
    .get(ownerId, kitId, cardId) as { id: string } | undefined;
  if (!ownedCard) throw new ValidationError("Referenced flashcard not found in this Kit");
  return ownedCard.id;
}

router.get("/export", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);

  try {
    const rows = db
      .prepare(
        `SELECT pillar_id, topic_id, section_id, content
         FROM guide_content
         WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND trim(content, ' ' || char(9) || char(10) || char(13)) != ''`,
      )
      .all(scope.ownerId, kit.id) as Array<{
      pillar_id: string;
      topic_id: string;
      section_id: string;
      content: string;
    }>;

    let markdown = `# ${kit.skeleton.identity.name} Study Guide\n\n`;

    for (const pillar of kit.skeleton.pillars) {
      const pillarRows = rows.filter((r) => r.pillar_id === pillar.id);
      if (pillarRows.length === 0) continue;

      markdown += `## Pillar: ${pillar.name}\n\n`;

      for (const topic of pillar.topics) {
        const topicRows = pillarRows.filter((r) => r.topic_id === topic.id);
        if (topicRows.length === 0) continue;

        markdown += `### Topic: ${topic.name}\n\n`;

        for (const section of pillar.sections) {
          const row = topicRows.find((r) => r.section_id === section.id);
          if (row) {
            markdown += `#### ${section.name}\n\n${row.content}\n\n`;
          }
        }
      }
    }

    res.setHeader("Content-Type", "text/markdown");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${kit.slug.replace(/[^a-z0-9-_]/gi, "_")}_guide.md"`,
    );
    res.send(markdown);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[guide-content] Error exporting guide:", msg);
    res.status(500).json({ message: "Failed to export guide" });
  }
});

router.get("/progress", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);

  const rows = db
    .prepare(
      `SELECT pillar_id, topic_id, section_id
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND trim(content, ' ' || char(9) || char(10) || char(13)) != ''`,
    )
    .all(scope.ownerId, kit.id) as Array<{
    pillar_id: string;
    topic_id: string;
    section_id: string;
  }>;

  const filled: Record<string, boolean> = {};
  for (const row of rows) {
    filled[`${row.pillar_id}__${row.topic_id}__${row.section_id}`] = true;
  }
  res.json(filled);
});

router.get("/dogears", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);

  const rows = db
    .prepare(
      `SELECT pillar_id, topic_id, section_id, created_at
       FROM guide_dogears
       WHERE ownerId = ? AND kit_id = ?
       ORDER BY created_at DESC`,
    )
    .all(scope.ownerId, kit.id) as Array<{
    pillar_id: string;
    topic_id: string;
    section_id: string;
    created_at: string | null;
  }>;

  res.json(
    rows.map((r) => ({
      pillarId: r.pillar_id,
      topicId: r.topic_id,
      sectionId: r.section_id,
      createdAt: r.created_at,
    })),
  );
});

router.post("/dogears/toggle", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { pillarId: rawPillarId, topicId: rawTopicId, sectionId: rawSectionId = "" } = req.body as {
    pillarId?: unknown;
    topicId?: unknown;
    sectionId?: unknown;
  };
  const { pillarId, topicId, sectionId: sec } = requireValidSlotRef(
    rawPillarId,
    rawTopicId,
    rawSectionId,
    false,
  );

  const result = db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT created_at FROM guide_dogears
         WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
      )
      .get(scope.ownerId, kit.id, pillarId, topicId, sec) as
      | { created_at: string | null }
      | undefined;

    if (existing) {
      db.prepare(
        `DELETE FROM guide_dogears
         WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
      ).run(scope.ownerId, kit.id, pillarId, topicId, sec);
      return { dogeared: false, createdAt: null };
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO guide_dogears (ownerId, kit_id, pillar_id, topic_id, section_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(scope.ownerId, kit.id, pillarId, topicId, sec, now);
    return { dogeared: true, createdAt: now };
  })();

  res.json(result);
});

router.get("/highlights", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const pillarId = typeof req.query.pillarId === "string" ? req.query.pillarId.trim() : "";
  const topicId = typeof req.query.topicId === "string" ? req.query.topicId.trim() : "";

  const rows =
    pillarId && topicId
      ? (db
          .prepare(
            `SELECT id, pillar_id, topic_id, section_id, quote, prefix, suffix, color, note, card_id, created_at, updated_at
             FROM guide_highlights
             WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ?
             ORDER BY created_at ASC`,
          )
          .all(scope.ownerId, kit.id, pillarId, topicId) as Array<Record<string, unknown>>)
      : pillarId
        ? (db
            .prepare(
              `SELECT id, pillar_id, topic_id, section_id, quote, prefix, suffix, color, note, card_id, created_at, updated_at
               FROM guide_highlights
               WHERE ownerId = ? AND kit_id = ? AND pillar_id = ?
               ORDER BY created_at ASC`,
            )
            .all(scope.ownerId, kit.id, pillarId) as Array<Record<string, unknown>>)
        : (db
            .prepare(
              `SELECT id, pillar_id, topic_id, section_id, quote, prefix, suffix, color, note, card_id, created_at, updated_at
               FROM guide_highlights
               WHERE ownerId = ? AND kit_id = ?
               ORDER BY created_at DESC`,
            )
            .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>);

  res.json(
    rows.map((r) => ({
      id: String(r.id),
      pillarId: String(r.pillar_id),
      topicId: String(r.topic_id),
      sectionId: String(r.section_id),
      quote: String(r.quote),
      prefix: String(r.prefix ?? ""),
      suffix: String(r.suffix ?? ""),
      color: String(r.color ?? "amber"),
      note: String(r.note ?? ""),
      cardId: (r.card_id as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
      updatedAt: (r.updated_at as string | null) ?? null,
    })),
  );
});

router.post("/highlights", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const {
    pillarId: rawPillarId,
    topicId: rawTopicId,
    sectionId: rawSectionId,
    quote,
    prefix = "",
    suffix = "",
    color = "amber",
    note = "",
    cardId = null,
  } = req.body as Record<string, unknown>;

  const { pillarId, topicId, sectionId } = requireValidSlotRef(
    rawPillarId,
    rawTopicId,
    rawSectionId,
    true,
  );
  if (typeof quote !== "string" || !quote.trim()) {
    throw new ValidationError("pillarId, topicId, sectionId, and quote are required");
  }
  if (typeof color !== "string" || !VALID_HIGHLIGHT_COLORS.has(color)) {
    throw new ValidationError("color must be amber, sage, or coral");
  }
  if (cardId !== null && cardId !== undefined && typeof cardId !== "string") {
    throw new ValidationError("cardId must be a string or null");
  }

  const verifiedCardId =
    typeof cardId === "string" && cardId.trim()
      ? verifyKitOwnedCardId(scope.ownerId, kit.id, cardId.trim())
      : null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const safePrefix = typeof prefix === "string" ? prefix.slice(0, 160) : "";
  const safeSuffix = typeof suffix === "string" ? suffix.slice(0, 160) : "";
  const safeNote = typeof note === "string" ? note.slice(0, 500) : "";
  const safeQuote = quote.trim().slice(0, 2000);

  db.prepare(
    `INSERT INTO guide_highlights (
       id, ownerId, kit_id, pillar_id, topic_id, section_id,
       quote, prefix, suffix, color, note, card_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    scope.ownerId,
    kit.id,
    pillarId,
    topicId,
    sectionId,
    safeQuote,
    safePrefix,
    safeSuffix,
    color,
    safeNote,
    verifiedCardId,
    now,
    now,
  );

  res.status(201).json({
    id,
    pillarId,
    topicId,
    sectionId,
    quote: safeQuote,
    prefix: safePrefix,
    suffix: safeSuffix,
    color,
    note: safeNote,
    cardId: verifiedCardId,
    createdAt: now,
    updatedAt: now,
  });
});

router.patch("/highlights/:id", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { id } = req.params;
  const { color, note, cardId } = req.body as Record<string, unknown>;

  const existing = db
    .prepare(
      `SELECT id, color, note, card_id FROM guide_highlights
       WHERE ownerId = ? AND kit_id = ? AND id = ?`,
    )
    .get(scope.ownerId, kit.id, id) as
    | { id: string; color: string; note: string; card_id: string | null }
    | undefined;

  if (!existing) throw new NotFoundError("Highlight");

  let nextColor = existing.color;
  if (color !== undefined) {
    if (typeof color !== "string" || !VALID_HIGHLIGHT_COLORS.has(color)) {
      throw new ValidationError("color must be amber, sage, or coral");
    }
    nextColor = color;
  }

  if (note !== undefined && typeof note !== "string") {
    throw new ValidationError("note must be a string");
  }
  const nextNote = typeof note === "string" ? note.slice(0, 500) : existing.note;

  let nextCardId = existing.card_id;
  if (cardId !== undefined) {
    if (cardId === null || cardId === "") {
      nextCardId = null;
    } else if (typeof cardId === "string") {
      nextCardId = verifyKitOwnedCardId(scope.ownerId, kit.id, cardId.trim());
    } else {
      throw new ValidationError("cardId must be a string or null");
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE guide_highlights
     SET color = ?, note = ?, card_id = ?, updated_at = ?
     WHERE ownerId = ? AND kit_id = ? AND id = ?`,
  ).run(nextColor, nextNote, nextCardId, now, scope.ownerId, kit.id, id);

  res.json({ id, color: nextColor, note: nextNote, cardId: nextCardId, updatedAt: now });
});

router.delete("/highlights/:id", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { id } = req.params;

  const info = db
    .prepare("DELETE FROM guide_highlights WHERE ownerId = ? AND kit_id = ? AND id = ?")
    .run(scope.ownerId, kit.id, id);

  if (info.changes === 0) throw new NotFoundError("Highlight");
  res.json({ ok: true });
});

router.get("/resume", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);

  const row = db
    .prepare("SELECT last_guide_ref FROM kits WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, kit.id) as { last_guide_ref: string | null } | undefined;

  if (!row?.last_guide_ref) {
    res.json({ resume: null });
    return;
  }
  try {
    const parsed = JSON.parse(row.last_guide_ref) as Record<string, unknown> | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.pillarId !== "string" ||
      !parsed.pillarId.trim() ||
      typeof parsed.topicId !== "string" ||
      !parsed.topicId.trim()
    ) {
      res.json({ resume: null });
      return;
    }
    res.json({
      resume: {
        pillarId: parsed.pillarId.trim(),
        topicId: parsed.topicId.trim(),
        sectionId: typeof parsed.sectionId === "string" ? parsed.sectionId.trim() : "",
        ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {}),
      },
    });
  } catch {
    res.json({ resume: null });
  }
});

router.put("/resume", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { pillarId: rawPillarId, topicId: rawTopicId, sectionId: rawSectionId = "" } =
    req.body as Record<string, unknown>;

  const { pillarId, topicId, sectionId } = requireValidSlotRef(
    rawPillarId,
    rawTopicId,
    rawSectionId,
    false,
  );
  const resume = {
    pillarId,
    topicId,
    sectionId,
    updatedAt: new Date().toISOString(),
  };

  db.prepare("UPDATE kits SET last_guide_ref = ?, updated_at = datetime('now') WHERE ownerId = ? AND id = ?").run(
    JSON.stringify(resume),
    scope.ownerId,
    kit.id,
  );
  res.json({ resume });
});

router.get("/:pillarId/:topicId", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { pillarId, topicId } = requireValidSlotRef(
    req.params.pillarId,
    req.params.topicId,
    "",
    false,
  );

  const rows = db
    .prepare(
      `SELECT section_id, content, committed_at
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ?`,
    )
    .all(scope.ownerId, kit.id, pillarId, topicId) as Array<{
    section_id: string;
    content: string;
    committed_at: string | null;
  }>;

  const result: Record<string, { content: string; committedAt: string | null }> =
    {};
  for (const row of rows) {
    result[row.section_id] = {
      content: row.content,
      committedAt: row.committed_at,
    };
  }
  res.json(result);
});

router.get("/:pillarId/:topicId/:sectionId", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { pillarId, topicId, sectionId } = requireValidSlotRef(
    req.params.pillarId,
    req.params.topicId,
    req.params.sectionId,
    true,
  );

  const row = db
    .prepare(
      `SELECT content, committed_at
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
    )
    .get(scope.ownerId, kit.id, pillarId, topicId, sectionId) as
    | { content: string; committed_at: string | null }
    | undefined;

  if (!row) {
    res.json({ content: "", committedAt: null });
    return;
  }
  res.json({ content: row.content, committedAt: row.committed_at });
});

router.put(
  "/:pillarId/:topicId/:sectionId",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const kit = resolveActiveKit(req, db, scope);
    const { pillarId, topicId, sectionId } = requireValidSlotRef(
      req.params.pillarId,
      req.params.topicId,
      req.params.sectionId,
      true,
    );
    const { content } = req.body as { content?: unknown };

    if (content === undefined || typeof content !== "string") {
      throw new ValidationError("content is required");
    }
    if (content.length > MAX_GUIDE_CONTENT_LEN) {
      throw new ValidationError(
        `content exceeds maximum length of ${MAX_GUIDE_CONTENT_LEN} characters`,
      );
    }

    db.prepare(
      `INSERT INTO guide_content (ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id)
       DO UPDATE SET content = excluded.content, committed_at = excluded.committed_at`,
    ).run(scope.ownerId, kit.id, pillarId, topicId, sectionId, content);

    const sourceRefId = `${pillarId}:${topicId}:${sectionId}`;
    if (content.trim()) {
      await upsertRagChunk(db, scope, {
        kitId: kit.id,
        kind: "guide",
        sourceRefId,
        title: `${topicId} — ${sectionId}`,
        content,
      });
    } else {
      deleteRagChunksBySource(db, scope, kit.id, "guide", sourceRefId);
    }

    res.json({ ok: true });
  }),
);

router.delete("/:pillarId/:topicId/:sectionId", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { pillarId, topicId, sectionId } = requireValidSlotRef(
    req.params.pillarId,
    req.params.topicId,
    req.params.sectionId,
    true,
  );

  db.prepare(
    `DELETE FROM guide_content
     WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
  ).run(scope.ownerId, kit.id, pillarId, topicId, sectionId);
  deleteRagChunksBySource(
    db,
    scope,
    kit.id,
    "guide",
    `${pillarId}:${topicId}:${sectionId}`,
  );
  res.json({ ok: true });
});

export default router;
