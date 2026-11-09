import { Router } from "express";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { ensureDefaultSystemDesignKit } from "../kits/kitsSchema.ts";
import logger from "../utils/logger.ts";

const router = Router();

router.get("/export", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);

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
  const kit = ensureDefaultSystemDesignKit(db, scope);

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

router.get("/:pillarId/:topicId", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
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
  const kit = ensureDefaultSystemDesignKit(db, scope);
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

router.put("/:pillarId/:topicId/:sectionId", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { pillarId, topicId, sectionId } = req.params;
  const { content } = req.body as { content?: string };

  if (content === undefined) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  db.prepare(
    `INSERT INTO guide_content (ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id)
     DO UPDATE SET content = excluded.content, committed_at = excluded.committed_at`,
  ).run(scope.ownerId, kit.id, pillarId, topicId, sectionId, content);

  res.json({ ok: true });
});

router.delete("/:pillarId/:topicId/:sectionId", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { pillarId, topicId, sectionId } = req.params;

  db.prepare(
    `DELETE FROM guide_content
     WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
  ).run(scope.ownerId, kit.id, pillarId, topicId, sectionId);
  res.json({ ok: true });
});

export default router;
