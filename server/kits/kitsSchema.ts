import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { LOCAL_OWNER_EMAIL } from "../appConfig.ts";
import { seal, open } from "../platform/crypto/secretBox.ts";
import { ensureLocalOwner as ensureLocalOwnerOnDb } from "../platform/db/platformSchema.ts";
import { registerOwnerDataHooks } from "../platform/db/connection.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import { log } from "../platform/net/errors.ts";
import {
  SYSTEM_DESIGN_KIT_SKELETON,
} from "../../shared/kits/systemDesignKit.ts";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";

const OFFICIAL_SYSTEM_DESIGN_SHARED_ID = "official-system-design";
const API_KEY_CONFIG_KEYS = new Set([
  "gemini_api_key",
  "claude_api_key",
  "openai_api_key",
]);

export function sealCredential(plain: string | null | undefined): string {
  if (!plain) return "";
  if (plain.startsWith("v1:")) return plain;
  return seal(plain);
}

export function openCredential(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith("v1:")) return stored;
  return open(stored);
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function hasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return cols.some((c) => c.name === column);
}

function createV2Tables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_catalog (
      catalog_id TEXT PRIMARY KEY,
      models TEXT NOT NULL DEFAULT '[]',
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shared_kits (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      publisher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      latest_version INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '📚',
      color TEXT NOT NULL DEFAULT '#006a91',
      tags TEXT NOT NULL DEFAULT '[]',
      is_official INTEGER NOT NULL DEFAULT 0,
      downloads_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shared_kit_versions (
      shared_kit_id TEXT NOT NULL REFERENCES shared_kits(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      changelog TEXT NOT NULL DEFAULT '',
      skeleton_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (shared_kit_id, version)
    );

    CREATE TABLE IF NOT EXISTS kits (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '📚',
      color TEXT NOT NULL DEFAULT '#006a91',
      status TEXT NOT NULL DEFAULT 'ready',
      status_detail TEXT DEFAULT NULL,
      skeleton_json TEXT NOT NULL,
      forked_from_shared_id TEXT REFERENCES shared_kits(id) ON DELETE SET NULL,
      forked_version INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_opened_at TEXT DEFAULT NULL,
      UNIQUE (ownerId, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_kits_owner ON kits(ownerId);

    CREATE TABLE IF NOT EXISTS guide_content (
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      pillar_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      content TEXT DEFAULT '',
      committed_at TEXT DEFAULT (datetime('now')),
      embedding TEXT DEFAULT NULL,
      PRIMARY KEY (ownerId, kit_id, pillar_id, topic_id, section_id)
    );

    CREATE TABLE IF NOT EXISTS chat_starters (
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      pillar_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      suggestions TEXT DEFAULT '[]',
      content_hash TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (ownerId, kit_id, pillar_id, topic_id)
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color_index INTEGER DEFAULT 0,
      tags TEXT DEFAULT '',
      settings TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_decks_owner_kit ON decks(ownerId, kit_id);

    CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      node_id TEXT DEFAULT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      ease_factor REAL DEFAULT 2.5,
      interval INTEGER DEFAULT 0,
      repetitions INTEGER DEFAULT 0,
      next_review TEXT DEFAULT NULL,
      last_reviewed TEXT DEFAULT NULL,
      state INTEGER DEFAULT 0,
      learning_step INTEGER DEFAULT 0,
      prerequisite_id TEXT DEFAULT NULL REFERENCES flashcards(id) ON DELETE SET NULL,
      embedding TEXT DEFAULT NULL,
      source_pillar_id TEXT DEFAULT NULL,
      source_topic_id TEXT DEFAULT NULL,
      source_section_id TEXT DEFAULT NULL,
      is_reverse INTEGER DEFAULT 0,
      reverse_of_id TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_flashcards_owner_deck ON flashcards(ownerId, deck_id);
    CREATE INDEX IF NOT EXISTS idx_flashcards_prereq ON flashcards(prerequisite_id);

    CREATE TABLE IF NOT EXISTS remediation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
      source_card_id TEXT NOT NULL,
      node_id TEXT DEFAULT NULL,
      node_name TEXT DEFAULT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_remediation_owner_open
      ON remediation_queue (ownerId, card_id) WHERE resolved_at IS NULL;

    CREATE TABLE IF NOT EXISTS drills (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      difficulty INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL,
      hints_json TEXT NOT NULL DEFAULT '[]',
      worked_solution TEXT NOT NULL DEFAULT '',
      rubric_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_drills_owner_kit ON drills(ownerId, kit_id);

    CREATE TABLE IF NOT EXISTS drill_attempts (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      drill_id TEXT NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
      submission TEXT NOT NULL,
      score REAL DEFAULT NULL,
      feedback_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_boards_owner_kit ON boards(ownerId, kit_id);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT NOT NULL,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      persona TEXT DEFAULT 'socratic',
      messages TEXT DEFAULT '[]',
      pillar_id TEXT DEFAULT NULL,
      topic_id TEXT DEFAULT NULL,
      topic_name TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (ownerId, id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_kit ON chat_sessions(ownerId, kit_id);

    CREATE TABLE IF NOT EXISTS kit_sources (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT DEFAULT NULL,
      file_path TEXT DEFAULT NULL,
      mime_type TEXT DEFAULT NULL,
      size_bytes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kit_source_chunks (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES kit_sources(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS episodic_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      memory_text TEXT NOT NULL,
      importance_score INTEGER DEFAULT 0,
      embedding TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_owner_kit ON episodic_memory(ownerId, kit_id);

    CREATE TABLE IF NOT EXISTS study_sessions (
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (ownerId, date)
    );

    CREATE TABLE IF NOT EXISTS user_learning_profile (
      ownerId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      profile_text TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_ai_settings (
      ownerId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider_keys_sealed TEXT DEFAULT '{}',
      custom_endpoints_json TEXT DEFAULT '[]',
      capabilities_json TEXT DEFAULT '{}',
      web_search_engine TEXT DEFAULT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function seedOfficialStarterKits(db: Database.Database): void {
  const skelJson = JSON.stringify(SYSTEM_DESIGN_KIT_SKELETON);
  const { identity } = SYSTEM_DESIGN_KIT_SKELETON;
  db.prepare(
    `INSERT INTO shared_kits (
       id, slug, publisher_user_id, latest_version, name, description, icon, color, tags, is_official, created_at, updated_at
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       icon = excluded.icon,
       color = excluded.color,
       tags = excluded.tags,
       is_official = 1`,
  ).run(
    OFFICIAL_SYSTEM_DESIGN_SHARED_ID,
    identity.slug,
    identity.version,
    identity.name,
    identity.description,
    identity.icon,
    identity.color,
    JSON.stringify(identity.tags),
  );

  const sharedRow = db
    .prepare("SELECT id FROM shared_kits WHERE slug = ?")
    .get(identity.slug) as { id: string };

  db.prepare(
    `INSERT INTO shared_kit_versions (shared_kit_id, version, changelog, skeleton_json, created_at)
     VALUES (?, ?, 'Official System Design starter curriculum', ?, datetime('now'))
     ON CONFLICT(shared_kit_id, version) DO UPDATE SET skeleton_json = excluded.skeleton_json`,
  ).run(sharedRow.id, identity.version, skelJson);
}

function sealPlaintextCredentialsInDb(db: Database.Database): void {
  if (hasTable(db, "config")) {
    const rows = db.prepare("SELECT key, value FROM config").all() as Array<{
      key: string;
      value: string;
    }>;
    const upd = db.prepare("UPDATE config SET value = ? WHERE key = ?");
    for (const r of rows) {
      if (API_KEY_CONFIG_KEYS.has(r.key) && r.value && !r.value.startsWith("v1:")) {
        upd.run(sealCredential(r.value), r.key);
      }
    }
  }
  if (hasTable(db, "custom_endpoints")) {
    const eps = db
      .prepare("SELECT id, api_key FROM custom_endpoints")
      .all() as Array<{ id: string; api_key: string | null }>;
    const updEp = db.prepare(
      "UPDATE custom_endpoints SET api_key = ? WHERE id = ?",
    );
    for (const ep of eps) {
      if (ep.api_key && !ep.api_key.startsWith("v1:")) {
        updEp.run(sealCredential(ep.api_key), ep.id);
      }
    }
  }
}

/**
 * Seamless v1 -> v2 single-user SQLite upgrade.
 * Preserves 100% of existing decks, cards, SRS state, guide notes, whiteboards,
 * chat sessions, study heatmap, memories, and profile under the local owner's
 * personal `system-design` Kit, while fixing any dangling `prerequisite_id`s.
 */
function migrateLegacyV1Database(db: Database.Database): void {
  log.info("db", "Upgrading legacy v1 toolbox.db to multi-tenant v2 schema");
  const legacyTables = [
    "decks",
    "flashcards",
    "guide_content",
    "chat_starters",
    "boards",
    "chat_sessions",
    "study_sessions",
    "episodic_memory",
    "remediation_queue",
    "user_profile",
  ];

  db.pragma("foreign_keys = OFF");
  try {
    const runUpgrade = db.transaction(() => {
      const localOwnerId = ensureLocalOwnerOnDb(db);

      for (const tbl of legacyTables) {
        if (hasTable(db, tbl)) {
          db.exec(`DROP INDEX IF EXISTS idx_remediation_open`);
          db.exec(`ALTER TABLE ${tbl} RENAME TO _v1_${tbl}`);
        }
      }

      createV2Tables(db);
      seedOfficialStarterKits(db);

      const kitId = crypto.randomUUID();
      const { identity } = SYSTEM_DESIGN_KIT_SKELETON;
      db.prepare(
        `INSERT INTO kits (
           id, ownerId, slug, name, description, icon, color, status,
           skeleton_json, forked_from_shared_id, forked_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, 1, datetime('now'), datetime('now'))`,
      ).run(
        kitId,
        localOwnerId,
        identity.slug,
        identity.name,
        identity.description,
        identity.icon,
        identity.color,
        JSON.stringify(SYSTEM_DESIGN_KIT_SKELETON),
        OFFICIAL_SYSTEM_DESIGN_SHARED_ID,
      );

      const validDeckIds = new Set<string>();
      if (hasTable(db, "_v1_decks")) {
        const rows = db.prepare("SELECT * FROM _v1_decks").all() as Array<
          Record<string, unknown>
        >;
        const ins = db.prepare(
          `INSERT INTO decks (id, ownerId, kit_id, name, description, color_index, tags, settings, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        );
        for (const r of rows) {
          const id = String(r.id);
          validDeckIds.add(id);
          ins.run(
            id,
            localOwnerId,
            kitId,
            String(r.name ?? "Untitled Deck"),
            String(r.description ?? ""),
            Number(r.color_index ?? 0),
            String(r.tags ?? ""),
            String(r.settings ?? "{}"),
            r.created_at ?? null,
            r.updated_at ?? null,
          );
        }
      }

      const validCardIds = new Set<string>();
      const pendingPrereqs: Array<{ id: string; prereqId: string }> = [];
      if (hasTable(db, "_v1_flashcards")) {
        const rows = db.prepare("SELECT * FROM _v1_flashcards").all() as Array<
          Record<string, unknown>
        >;
        const ins = db.prepare(
          `INSERT INTO flashcards (
             id, ownerId, deck_id, node_id, front, back, position,
             ease_factor, interval, repetitions, next_review, last_reviewed,
             state, learning_step, prerequisite_id, embedding,
             source_pillar_id, source_topic_id, source_section_id,
             is_reverse, reverse_of_id, created_at, updated_at
           ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        );
        for (const r of rows) {
          const deckId = String(r.deck_id ?? "");
          if (!validDeckIds.has(deckId)) continue;
          const id = String(r.id);
          validCardIds.add(id);
          const reps = Number(r.repetitions ?? 0);
          let state = Number(r.state ?? 0);
          if (state === 0 && reps > 0) state = 2;

          ins.run(
            id,
            localOwnerId,
            deckId,
            String(r.front ?? ""),
            String(r.back ?? ""),
            Number(r.position ?? 0),
            r.ease_factor !== undefined && r.ease_factor !== null
              ? Number(r.ease_factor)
              : 2.5,
            Number(r.interval ?? 0),
            reps,
            (r.next_review as string | null) ?? null,
            (r.last_reviewed as string | null) ?? null,
            state,
            Number(r.learning_step ?? 0),
            (r.embedding as string | null) ?? null,
            (r.source_pillar_id as string | null) ?? null,
            (r.source_topic_id as string | null) ?? null,
            (r.source_section_id as string | null) ?? null,
            Number(r.is_reverse ?? 0),
            (r.reverse_of_id as string | null) ?? null,
            r.created_at ?? null,
            r.updated_at ?? null,
          );
          if (typeof r.prerequisite_id === "string" && r.prerequisite_id.trim()) {
            pendingPrereqs.push({ id, prereqId: r.prerequisite_id.trim() });
          }
        }
        // Only restore prerequisite_id when the referenced card still exists (eliminates orphan deadlocks).
        const updPrereq = db.prepare(
          "UPDATE flashcards SET prerequisite_id = ? WHERE ownerId = ? AND id = ?",
        );
        for (const p of pendingPrereqs) {
          if (validCardIds.has(p.prereqId) && p.prereqId !== p.id) {
            updPrereq.run(p.prereqId, localOwnerId, p.id);
          }
        }
      }

      if (hasTable(db, "_v1_guide_content")) {
        const rows = db
          .prepare("SELECT * FROM _v1_guide_content")
          .all() as Array<Record<string, unknown>>;
        const ins = db.prepare(
          `INSERT INTO guide_content (ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at, embedding)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
        );
        for (const r of rows) {
          ins.run(
            localOwnerId,
            kitId,
            String(r.pillar_id),
            String(r.topic_id),
            String(r.section_id),
            String(r.content ?? ""),
            r.committed_at ?? null,
            (r.embedding as string | null) ?? null,
          );
        }
      }

      if (hasTable(db, "_v1_chat_starters")) {
        const rows = db
          .prepare("SELECT * FROM _v1_chat_starters")
          .all() as Array<Record<string, unknown>>;
        const ins = db.prepare(
          `INSERT INTO chat_starters (ownerId, kit_id, pillar_id, topic_id, suggestions, content_hash, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        );
        for (const r of rows) {
          ins.run(
            localOwnerId,
            kitId,
            String(r.pillar_id),
            String(r.topic_id),
            String(r.suggestions ?? "[]"),
            String(r.content_hash ?? ""),
            r.updated_at ?? null,
          );
        }
      }

      if (hasTable(db, "_v1_boards")) {
        const rows = db.prepare("SELECT * FROM _v1_boards").all() as Array<
          Record<string, unknown>
        >;
        const ins = db.prepare(
          `INSERT INTO boards (id, ownerId, kit_id, name, data, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        );
        rows.forEach((r, idx) => {
          ins.run(
            String(r.id),
            localOwnerId,
            kitId,
            String(r.name ?? "Untitled Board"),
            String(r.data ?? "{}"),
            r.position !== undefined && r.position !== null
              ? Number(r.position)
              : idx,
            r.created_at ?? null,
            r.updated_at ?? null,
          );
        });
      }

      if (hasTable(db, "_v1_chat_sessions")) {
        const rows = db
          .prepare("SELECT * FROM _v1_chat_sessions")
          .all() as Array<Record<string, unknown>>;
        const ins = db.prepare(
          `INSERT INTO chat_sessions (id, ownerId, kit_id, name, persona, messages, pillar_id, topic_id, topic_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'socratic', ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        );
        for (const r of rows) {
          ins.run(
            String(r.id),
            localOwnerId,
            kitId,
            String(r.name ?? "Session"),
            String(r.messages ?? "[]"),
            (r.pillar_id as string | null) ?? null,
            (r.topic_id as string | null) ?? null,
            (r.topic_name as string | null) ?? null,
            r.created_at ?? null,
            r.updated_at ?? null,
          );
        }
      }

      if (hasTable(db, "_v1_study_sessions")) {
        const rows = db
          .prepare("SELECT * FROM _v1_study_sessions")
          .all() as Array<Record<string, unknown>>;
        const ins = db.prepare(
          `INSERT INTO study_sessions (ownerId, date, count) VALUES (?, ?, ?)`,
        );
        for (const r of rows) {
          ins.run(localOwnerId, String(r.date), Number(r.count ?? 0));
        }
      }

      if (hasTable(db, "_v1_episodic_memory")) {
        const rows = db
          .prepare("SELECT * FROM _v1_episodic_memory")
          .all() as Array<Record<string, unknown>>;
        const ins = db.prepare(
          `INSERT INTO episodic_memory (ownerId, kit_id, memory_text, importance_score, embedding, created_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        );
        for (const r of rows) {
          ins.run(
            localOwnerId,
            kitId,
            String(r.memory_text ?? ""),
            Number(r.importance_score ?? 0),
            (r.embedding as string | null) ?? null,
            r.created_at ?? null,
          );
        }
      }

      if (hasTable(db, "_v1_remediation_queue")) {
        const rows = db
          .prepare("SELECT * FROM _v1_remediation_queue")
          .all() as Array<Record<string, unknown>>;
        const ins = db.prepare(
          `INSERT INTO remediation_queue (ownerId, kit_id, card_id, source_card_id, node_id, node_name, reason, created_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
        );
        for (const r of rows) {
          const cardId = String(r.card_id ?? "");
          if (!validCardIds.has(cardId)) continue;
          ins.run(
            localOwnerId,
            kitId,
            cardId,
            String(r.source_card_id ?? ""),
            (r.node_id as string | null) ?? null,
            (r.node_name as string | null) ?? null,
            String(r.reason ?? ""),
            r.created_at ?? null,
            (r.resolved_at as string | null) ?? null,
          );
        }
      }

      if (hasTable(db, "_v1_user_profile")) {
        const row = db
          .prepare("SELECT * FROM _v1_user_profile WHERE id = 1")
          .get() as Record<string, unknown> | undefined;
        if (row?.profile_text) {
          db.prepare(
            `INSERT INTO user_learning_profile (ownerId, profile_text, updated_at)
             VALUES (?, ?, COALESCE(?, datetime('now')))`,
          ).run(
            localOwnerId,
            String(row.profile_text),
            row.updated_at ?? null,
          );
        }
      }

      for (const tbl of legacyTables) {
        db.exec(`DROP TABLE IF EXISTS _v1_${tbl}`);
      }

      sealPlaintextCredentialsInDb(db);
    });

    runUpgrade();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function initKitsSchema(db: Database.Database): void {
  if (hasTable(db, "decks") && !hasColumn(db, "decks", "ownerId")) {
    migrateLegacyV1Database(db);
  } else {
    createV2Tables(db);
    seedOfficialStarterKits(db);
    sealPlaintextCredentialsInDb(db);
  }

  registerOwnerDataHooks({
    countedTables: [
      "users",
      "kits",
      "decks",
      "flashcards",
      "guide_content",
      "boards",
      "chat_sessions",
    ],
    countDeviceItems: () => {
      const local = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(LOCAL_OWNER_EMAIL) as { id: string } | undefined;
      if (!local) return 0;
      const cards = (
        db
          .prepare("SELECT COUNT(*) as c FROM flashcards WHERE ownerId = ?")
          .get(local.id) as { c: number }
      ).c;
      const notes = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM guide_content WHERE ownerId = ? AND content != ''",
          )
          .get(local.id) as { c: number }
      ).c;
      const boards = (
        db
          .prepare("SELECT COUNT(*) as c FROM boards WHERE ownerId = ?")
          .get(local.id) as { c: number }
      ).c;
      return cards + notes + boards;
    },
    countItemsByOwner: () => {
      const map = new Map<string, number>();
      const cardRows = db
        .prepare(
          "SELECT ownerId, COUNT(*) as c FROM flashcards GROUP BY ownerId",
        )
        .all() as Array<{ ownerId: string; c: number }>;
      for (const r of cardRows) map.set(r.ownerId, (map.get(r.ownerId) ?? 0) + r.c);

      const noteRows = db
        .prepare(
          "SELECT ownerId, COUNT(*) as c FROM guide_content WHERE content != '' GROUP BY ownerId",
        )
        .all() as Array<{ ownerId: string; c: number }>;
      for (const r of noteRows) map.set(r.ownerId, (map.get(r.ownerId) ?? 0) + r.c);

      return map;
    },
    ownedCounts: (ownerId: string) => {
      const count = (sql: string) =>
        (db.prepare(sql).get(ownerId) as { c: number }).c;
      return {
        kits: count("SELECT COUNT(*) as c FROM kits WHERE ownerId = ?"),
        decks: count("SELECT COUNT(*) as c FROM decks WHERE ownerId = ?"),
        flashcards: count(
          "SELECT COUNT(*) as c FROM flashcards WHERE ownerId = ?",
        ),
        guideSections: count(
          "SELECT COUNT(*) as c FROM guide_content WHERE ownerId = ? AND content != ''",
        ),
        boards: count("SELECT COUNT(*) as c FROM boards WHERE ownerId = ?"),
        chatSessions: count(
          "SELECT COUNT(*) as c FROM chat_sessions WHERE ownerId = ?",
        ),
      };
    },
    purgeOwnerData: (ownerId: string) => {
      // Explicit cleanup alongside ON DELETE CASCADE for thoroughness.
      db.prepare("DELETE FROM kits WHERE ownerId = ?").run(ownerId);
      db.prepare("DELETE FROM study_sessions WHERE ownerId = ?").run(ownerId);
      db.prepare("DELETE FROM user_learning_profile WHERE ownerId = ?").run(
        ownerId,
      );
      db.prepare("DELETE FROM user_ai_settings WHERE ownerId = ?").run(ownerId);
    },
  });
}

export interface ActiveKitContext {
  id: string;
  slug: string;
  skeleton: KitSkeletonV1;
}

/**
 * Ensures the caller owns a `system-design` Kit (forked lazily from Official Shared Kits)
 * and returns its ID and parsed skeleton. Used by v1 routes until `/k/:slug` lands in M2.
 */
export function ensureDefaultSystemDesignKit(
  db: Database.Database,
  scope: Scope,
): ActiveKitContext {
  const existing = db
    .prepare(
      "SELECT id, slug, skeleton_json FROM kits WHERE ownerId = ? AND slug = 'system-design'",
    )
    .get(scope.ownerId) as
    | { id: string; slug: string; skeleton_json: string }
    | undefined;

  if (existing) {
    let skeleton = SYSTEM_DESIGN_KIT_SKELETON;
    try {
      skeleton = JSON.parse(existing.skeleton_json) as KitSkeletonV1;
    } catch {
      // Fallback to canonical skeleton if corrupted
    }
    return { id: existing.id, slug: existing.slug, skeleton };
  }

  const id = crypto.randomUUID();
  const { identity } = SYSTEM_DESIGN_KIT_SKELETON;
  const shared = db
    .prepare("SELECT id, latest_version FROM shared_kits WHERE slug = 'system-design'")
    .get() as { id: string; latest_version: number } | undefined;

  db.prepare(
    `INSERT INTO kits (
       id, ownerId, slug, name, description, icon, color, status,
       skeleton_json, forked_from_shared_id, forked_version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    id,
    scope.ownerId,
    identity.slug,
    identity.name,
    identity.description,
    identity.icon,
    identity.color,
    JSON.stringify(SYSTEM_DESIGN_KIT_SKELETON),
    shared?.id ?? null,
    shared?.latest_version ?? 1,
  );

  return { id, slug: identity.slug, skeleton: SYSTEM_DESIGN_KIT_SKELETON };
}
