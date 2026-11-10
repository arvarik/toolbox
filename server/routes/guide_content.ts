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

router.get("/export", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);

  try {
    const rows = db
      .prepare(
        `SELECT pillar_id, topic_id, section_id, content
         FROM guide_content
         WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND content != ''`,
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
      `SELECT pillar_id, topic_id, section_id, length(content) as len
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND content != ''`,
    )
    .all(scope.ownerId, kit.id) as Array<{
    pillar_id: string;
    topic_id: string;
    section_id: string;
    len: number;
  }>;

  const filled: Record<string, boolean> = {};
  for (const row of rows) {
    if (row.len > 0) {
      filled[`${row.pillar_id}__${row.topic_id}__${row.section_id}`] = true;
    }
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
  const { pillarId, topicId, sectionId = "" } = req.body as {
    pillarId?: unknown;
    topicId?: unknown;
    sectionId?: unknown;
  };

  if (typeof pillarId !== "string" || !pillarId.trim() || typeof topicId !== "string" || !topicId.trim()) {
    throw new ValidationError("pillarId and topicId are required");
  }
  const sec = typeof sectionId === "string" ? sectionId.trim() : "";

  const existing = db
    .prepare(
      `SELECT created_at FROM guide_dogears
       WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
    )
    .get(scope.ownerId, kit.id, pillarId.trim(), topicId.trim(), sec) as
    | { created_at: string | null }
    | undefined;

  if (existing) {
    db.prepare(
      `DELETE FROM guide_dogears
       WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
    ).run(scope.ownerId, kit.id, pillarId.trim(), topicId.trim(), sec);
    res.json({ dogeared: false, createdAt: null });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO guide_dogears (ownerId, kit_id, pillar_id, topic_id, section_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(scope.ownerId, kit.id, pillarId.trim(), topicId.trim(), sec, now);
  res.json({ dogeared: true, createdAt: now });
});

router.get("/highlights", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const pillarId = typeof req.query.pillarId === "string" ? req.query.pillarId : null;
  const topicId = typeof req.query.topicId === "string" ? req.query.topicId : null;

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
    pillarId,
    topicId,
    sectionId,
    quote,
    prefix = "",
    suffix = "",
    color = "amber",
    note = "",
    cardId = null,
  } = req.body as Record<string, unknown>;

  if (
    typeof pillarId !== "string" ||
    !pillarId.trim() ||
    typeof topicId !== "string" ||
    !topicId.trim() ||
    typeof sectionId !== "string" ||
    !sectionId.trim() ||
    typeof quote !== "string" ||
    !quote.trim()
  ) {
    throw new ValidationError("pillarId, topicId, sectionId, and quote are required");
  }
  const safeColor = typeof color === "string" && VALID_HIGHLIGHT_COLORS.has(color) ? color : "amber";
  if (typeof color === "string" && !VALID_HIGHLIGHT_COLORS.has(color)) {
    throw new ValidationError("color must be amber, sage, or coral");
  }

  let verifiedCardId: string | null = null;
  if (typeof cardId === "string" && cardId.trim()) {
    const ownedCard = db
      .prepare("SELECT id FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(scope.ownerId, cardId.trim()) as { id: string } | undefined;
    if (!ownedCard) throw new ValidationError("Referenced flashcard not found");
    verifiedCardId = ownedCard.id;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const safePrefix = typeof prefix === "string" ? prefix.slice(0, 160) : "";
  const safeSuffix = typeof suffix === "string" ? suffix.slice(0, 160) : "";
  const safeNote = typeof note === "string" ? note.slice(0, 500) : "";
  const safeQuote = quote.slice(0, 2000);

  db.prepare(
    `INSERT INTO guide_highlights (
       id, ownerId, kit_id, pillar_id, topic_id, section_id,
       quote, prefix, suffix, color, note, card_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    scope.ownerId,
    kit.id,
    pillarId.trim(),
    topicId.trim(),
    sectionId.trim(),
    safeQuote,
    safePrefix,
    safeSuffix,
    safeColor,
    safeNote,
    verifiedCardId,
    now,
    now,
  );

  res.status(201).json({
    id,
    pillarId: pillarId.trim(),
    topicId: topicId.trim(),
    sectionId: sectionId.trim(),
    quote: safeQuote,
    prefix: safePrefix,
    suffix: safeSuffix,
    color: safeColor,
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

  const nextNote = typeof note === "string" ? note.slice(0, 500) : existing.note;
  let nextCardId = existing.card_id;
  if (cardId !== undefined) {
    if (cardId === null || cardId === "") {
      nextCardId = null;
    } else if (typeof cardId === "string") {
      const ownedCard = db
        .prepare("SELECT id FROM flashcards WHERE ownerId = ? AND id = ?")
        .get(scope.ownerId, cardId.trim()) as { id: string } | undefined;
      if (!ownedCard) throw new ValidationError("Referenced flashcard not found");
      nextCardId = ownedCard.id;
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
    res.json({ resume: JSON.parse(row.last_guide_ref) });
  } catch {
    res.json({ resume: null });
  }
});

router.put("/resume", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { pillarId, topicId, sectionId = "" } = req.body as Record<string, unknown>;

  if (typeof pillarId !== "string" || !pillarId.trim() || typeof topicId !== "string" || !topicId.trim()) {
    throw new ValidationError("pillarId and topicId are required");
  }
  const resume = {
    pillarId: pillarId.trim(),
    topicId: topicId.trim(),
    sectionId: typeof sectionId === "string" ? sectionId.trim() : "",
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
  const { pillarId, topicId } = req.params;

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
  const { pillarId, topicId, sectionId } = req.params;

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
    const { pillarId, topicId, sectionId } = req.params;
    const { content } = req.body as { content?: string };

    if (content === undefined || typeof content !== "string") {
      res.status(400).json({ message: "content is required" });
      return;
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
  const { pillarId, topicId, sectionId } = req.params;

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
