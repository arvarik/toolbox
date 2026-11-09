import type Database from "better-sqlite3";
import { NotFoundError, ValidationError } from "../platform/net/errors.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import {
  deleteGuideSlotAndRag,
  getOwnedKit,
  parseStoredSkeleton,
  safeSkeletonSlotSet,
  seedKitStarterContent,
  validateAndVerifySkeleton,
  type OwnedKitDetail,
} from "./kitService.ts";

export interface KitSyncResult {
  kit: OwnedKitDetail;
  addedCards: number;
  addedDrills: number;
  addedGuideNotes: number;
  remappedCards: number;
  clearedOrphanNodeCards: number;
  remappedGuideNotes: number;
  archivedNotesCount: number;
}

export function syncKitStructure(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
  nextSkeletonInput: unknown,
  opts: { forkedVersion?: number; forkedFromSharedId?: string | null } = {},
): KitSyncResult {
  const verified = validateAndVerifySkeleton(nextSkeletonInput);
  const existing = getOwnedKit(db, scope, slugOrId);

  const normalizedSkeleton: KitSkeletonV1 = {
    ...verified,
    identity: { ...verified.identity, slug: existing.slug },
  };

  const nodeAliases = normalizedSkeleton.migrations?.nodeAliases ?? {};
  const topicAliases = normalizedSkeleton.migrations?.topicAliases ?? {};
  const validNodeIds = new Set(normalizedSkeleton.graph.nodes.map((n) => n.id));
  const validSlots = safeSkeletonSlotSet(normalizedSkeleton);

  // Build map of topicId -> pillars containing it for cross-pillar move detection
  const pillarsById = new Map(
    normalizedSkeleton.pillars.map((p) => [
      p.id,
      {
        topics: new Set(p.topics.map((t) => t.id)),
        sections: new Set(p.sections.map((s) => s.id)),
      },
    ]),
  );
  const uniqueTopicPillar = new Map<string, string | null>();
  for (const p of normalizedSkeleton.pillars) {
    for (const t of p.topics) {
      uniqueTopicPillar.set(t.id, uniqueTopicPillar.has(t.id) ? null : p.id);
    }
  }

  const stats = db.transaction(() => {
    const nextForkedVersion =
      opts.forkedVersion ?? normalizedSkeleton.identity.version ?? existing.forkedVersion;
    const nextSharedId =
      opts.forkedFromSharedId !== undefined
        ? opts.forkedFromSharedId
        : existing.forkedFromSharedId;

    db.prepare(
      `UPDATE kits
       SET name = ?, description = ?, icon = ?, color = ?,
           skeleton_json = ?, forked_from_shared_id = ?, forked_version = ?,
           updated_at = datetime('now')
       WHERE ownerId = ? AND id = ?`,
    ).run(
      normalizedSkeleton.identity.name,
      normalizedSkeleton.identity.description,
      normalizedSkeleton.identity.icon,
      normalizedSkeleton.identity.color,
      JSON.stringify(normalizedSkeleton),
      nextSharedId,
      nextForkedVersion,
      scope.ownerId,
      existing.id,
    );

    // 1. Remap flashcards.node_id via nodeAliases or clear removed node_ids
    const cardNodes = db
      .prepare(
        `SELECT f.id, f.node_id
         FROM flashcards f
         JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
         WHERE f.ownerId = ? AND d.kit_id = ? AND f.node_id IS NOT NULL`,
      )
      .all(scope.ownerId, existing.id) as Array<{ id: string; node_id: string }>;

    let remappedCards = 0;
    let clearedOrphanNodeCards = 0;
    const updateCardNode = db.prepare(
      "UPDATE flashcards SET node_id = ?, updated_at = datetime('now') WHERE ownerId = ? AND id = ?",
    );

    for (const card of cardNodes) {
      const aliased = nodeAliases[card.node_id] ?? card.node_id;
      if (validNodeIds.has(aliased)) {
        if (aliased !== card.node_id) {
          updateCardNode.run(aliased, scope.ownerId, card.id);
          remappedCards++;
        }
      } else {
        updateCardNode.run(null, scope.ownerId, card.id);
        clearedOrphanNodeCards++;
      }
    }

    // Also keep remediation_queue.node_id aligned
    const remRows = db
      .prepare(
        "SELECT id, node_id FROM remediation_queue WHERE ownerId = ? AND kit_id = ? AND node_id IS NOT NULL",
      )
      .all(scope.ownerId, existing.id) as Array<{ id: number; node_id: string }>;
    const updateRemNode = db.prepare(
      "UPDATE remediation_queue SET node_id = ? WHERE ownerId = ? AND id = ?",
    );
    for (const r of remRows) {
      const aliased = nodeAliases[r.node_id] ?? r.node_id;
      const finalNode = validNodeIds.has(aliased) ? aliased : null;
      if (finalNode !== r.node_id) updateRemNode.run(finalNode, scope.ownerId, r.id);
    }

    // 2. Remap drills.node_id when aliased to a valid node (NEVER DELETE drills!)
    const updateDrillNode = db.prepare(
      "UPDATE drills SET node_id = ? WHERE ownerId = ? AND kit_id = ? AND node_id = ?",
    );
    for (const [oldNodeId, newNodeId] of Object.entries(nodeAliases)) {
      if (oldNodeId !== newNodeId && validNodeIds.has(newNodeId)) {
        updateDrillNode.run(newNodeId, scope.ownerId, existing.id, oldNodeId);
      }
    }

    // 3. Remap moved guide_content via topicAliases or cross-pillar topic moves
    const guideRows = db
      .prepare(
        `SELECT pillar_id, topic_id, section_id, content, committed_at, embedding
         FROM guide_content
         WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND content != ''`,
      )
      .all(scope.ownerId, existing.id) as Array<{
      pillar_id: string;
      topic_id: string;
      section_id: string;
      content: string;
      committed_at: string | null;
      embedding: string | null;
    }>;

    let remappedGuideNotes = 0;
    const checkDestStmt = db.prepare(
      `SELECT content FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
    );
    const upsertDestStmt = db.prepare(
      `INSERT INTO guide_content (
         ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at, embedding
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id) DO UPDATE SET
         content = excluded.content,
         committed_at = excluded.committed_at,
         embedding = excluded.embedding
       WHERE guide_content.content IS NULL OR guide_content.content = ''`,
    );

    for (const g of guideRows) {
      if (validSlots.has(`${g.pillar_id}\0${g.topic_id}\0${g.section_id}`)) continue;

      const targetTopicId = topicAliases[g.topic_id] ?? g.topic_id;
      const samePillar = pillarsById.get(g.pillar_id);
      const movedPillarId = uniqueTopicPillar.get(targetTopicId) ?? null;
      const targetPillarId =
        samePillar?.topics.has(targetTopicId) && samePillar.sections.has(g.section_id)
          ? g.pillar_id
          : movedPillarId && pillarsById.get(movedPillarId)?.sections.has(g.section_id)
            ? movedPillarId
            : null;

      // Leave unmapped notes intact in guide_content -> surfaced in Archived Notes drawer
      if (!targetPillarId) continue;

      const dest = checkDestStmt.get(
        scope.ownerId,
        existing.id,
        targetPillarId,
        targetTopicId,
        g.section_id,
      ) as { content: string } | undefined;

      if (!dest?.content) {
        upsertDestStmt.run(
          scope.ownerId,
          existing.id,
          targetPillarId,
          targetTopicId,
          g.section_id,
          g.content,
          g.committed_at,
          g.embedding,
        );
        deleteGuideSlotAndRag(db, scope, existing.id, g.pillar_id, g.topic_id, g.section_id);
        remappedGuideNotes++;
      }
    }

    // 4. Hydrate unseen starter cards, unseen drills, and empty-slot baseline guide notes
    const seeded = seedKitStarterContent(db, scope, existing.id, normalizedSkeleton);
    return { ...seeded, remappedCards, clearedOrphanNodeCards, remappedGuideNotes };
  })();

  const updatedKit = getOwnedKit(db, scope, existing.id);
  return {
    kit: updatedKit,
    ...stats,
    archivedNotesCount: updatedKit.archivedNotesCount,
  };
}

export function pullUpstreamKitUpdate(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
): KitSyncResult {
  const existing = getOwnedKit(db, scope, slugOrId);
  if (!existing.forkedFromSharedId) {
    throw new ValidationError("This Kit is not linked to a Shared Library upstream");
  }

  const shared = db
    .prepare("SELECT id, latest_version FROM shared_kits WHERE id = ?")
    .get(existing.forkedFromSharedId) as { id: string; latest_version: number } | undefined;
  if (!shared) throw new NotFoundError("Upstream Shared Kit", existing.forkedFromSharedId);

  const latestVer = db
    .prepare(
      `SELECT version, skeleton_json FROM shared_kit_versions
       WHERE shared_kit_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(shared.id) as { version: number; skeleton_json: string } | undefined;
  if (!latestVer) throw new NotFoundError("Upstream Shared Kit version", shared.id);

  return syncKitStructure(db, scope, existing.id, parseStoredSkeleton(latestVer.skeleton_json), {
    forkedVersion: latestVer.version,
    forkedFromSharedId: shared.id,
  });
}
