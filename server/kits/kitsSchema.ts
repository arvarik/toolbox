import crypto from "node:crypto";
import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { LOCAL_OWNER_EMAIL } from "../appConfig.ts";
import { sealCredential } from "../platform/crypto/secretBox.ts";
import { ensureLocalOwner as ensureLocalOwnerOnDb } from "../platform/db/platformSchema.ts";
import { registerOwnerDataHooks } from "../platform/db/connection.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import { log } from "../platform/net/errors.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";

const OFFICIAL_SYSTEM_DESIGN_SHARED_ID = "official-system-design";
const API_KEY_CONFIG_KEYS = new Set(["gemini_api_key", "claude_api_key", "openai_api_key"]);

const RAG_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS rag_chunks (
    chunk_id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    source_ref_id TEXT NOT NULL,
    node_id TEXT DEFAULT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding_gen TEXT DEFAULT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rag_chunks_owner_kit ON rag_chunks(ownerId, kit_id, kind);
  CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(ownerId, kit_id, kind, source_ref_id);
  CREATE INDEX IF NOT EXISTS idx_rag_chunks_missing_emb ON rag_chunks(ownerId, chunk_id) WHERE embedding_gen IS NULL;

  CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    ownerTok,
    kitTok,
    kindTok,
    title,
    content,
    tokenize='porter unicode61'
  );
`;

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
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
      last_guide_ref TEXT DEFAULT NULL,
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

    CREATE TABLE IF NOT EXISTS guide_dogears (
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      pillar_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (ownerId, kit_id, pillar_id, topic_id, section_id)
    );
    CREATE INDEX IF NOT EXISTS idx_guide_dogears_owner_kit
      ON guide_dogears(ownerId, kit_id);

    CREATE TABLE IF NOT EXISTS guide_highlights (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      pillar_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      quote TEXT NOT NULL,
      prefix TEXT DEFAULT '',
      suffix TEXT DEFAULT '',
      color TEXT NOT NULL DEFAULT 'amber' CHECK (color IN ('amber', 'sage', 'coral')),
      note TEXT DEFAULT '',
      card_id TEXT DEFAULT NULL REFERENCES flashcards(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_guide_highlights_owner_kit_topic
      ON guide_highlights(ownerId, kit_id, pillar_id, topic_id);

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
      seed_key TEXT DEFAULT NULL,
      stability REAL DEFAULT NULL,
      difficulty REAL DEFAULT NULL,
      lapses INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_flashcards_owner_deck ON flashcards(ownerId, deck_id);
    CREATE INDEX IF NOT EXISTS idx_flashcards_prereq ON flashcards(prerequisite_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcards_seed_key
      ON flashcards(ownerId, deck_id, seed_key) WHERE seed_key IS NOT NULL;

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
      seed_key TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_drills_owner_kit ON drills(ownerId, kit_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_drills_seed_key
      ON drills(ownerId, kit_id, seed_key) WHERE seed_key IS NOT NULL;

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
  ensureV2Indexes(db);
  db.exec(RAG_TABLES_DDL);
}

function ensureV2Indexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shared_kits_publisher
      ON shared_kits(publisher_user_id);
    CREATE INDEX IF NOT EXISTS idx_kits_forked_shared
      ON kits(forked_from_shared_id);
    CREATE INDEX IF NOT EXISTS idx_guide_dogears_owner_kit_created
      ON guide_dogears(ownerId, kit_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_guide_highlights_owner_kit_created
      ON guide_highlights(ownerId, kit_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_guide_highlights_card
      ON guide_highlights(card_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcards_seed_key
      ON flashcards(ownerId, deck_id, seed_key) WHERE seed_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_drills_seed_key
      ON drills(ownerId, kit_id, seed_key) WHERE seed_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_flashcards_owner_deck_due
      ON flashcards(ownerId, deck_id, state, next_review);
    CREATE INDEX IF NOT EXISTS idx_flashcards_owner_deck_reviewed
      ON flashcards(ownerId, deck_id, last_reviewed);
    CREATE INDEX IF NOT EXISTS idx_flashcards_owner_deck_pos
      ON flashcards(ownerId, deck_id, position, created_at);
    CREATE INDEX IF NOT EXISTS idx_remediation_card
      ON remediation_queue(card_id);
    CREATE INDEX IF NOT EXISTS idx_remediation_owner_kit
      ON remediation_queue(ownerId, kit_id);
    CREATE INDEX IF NOT EXISTS idx_remediation_owner_kit_open
      ON remediation_queue(ownerId, kit_id) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_drills_owner_kit_node_diff
      ON drills(ownerId, kit_id, node_id, difficulty, created_at);
    CREATE INDEX IF NOT EXISTS idx_drill_attempts_owner_drill
      ON drill_attempts(ownerId, drill_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_boards_owner_kit_pos
      ON boards(ownerId, kit_id, position, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_kit_updated
      ON chat_sessions(ownerId, kit_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kit_sources_owner_kit
      ON kit_sources(ownerId, kit_id);
    CREATE INDEX IF NOT EXISTS idx_kit_source_chunks_owner_kit_src
      ON kit_source_chunks(ownerId, kit_id, source_id);
  `);
}

const loadedVecDbs = new WeakSet<Database.Database>();

export function ensureVecExtensionLoaded(db: Database.Database): void {
  if (loadedVecDbs.has(db)) return;
  sqliteVec.load(db);
  loadedVecDbs.add(db);
}

export function ownerTokFor(ownerId: string): string {
  return `o_${ownerId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

export function kitTokFor(kitId: string): string {
  return `k_${kitId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function ensureV2ColumnMigrations(db: Database.Database): void {
  const addCol = (table: string, col: string, def: string) => {
    if (hasTable(db, table) && !hasColumn(db, table, col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };

  addCol("flashcards", "seed_key", "TEXT DEFAULT NULL");
  addCol("flashcards", "stability", "REAL DEFAULT NULL");
  addCol("flashcards", "difficulty", "REAL DEFAULT NULL");
  addCol("flashcards", "lapses", "INTEGER DEFAULT 0");
  addCol("drills", "seed_key", "TEXT DEFAULT NULL");
  addCol("kits", "last_guide_ref", "TEXT DEFAULT NULL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS guide_dogears (
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      pillar_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (ownerId, kit_id, pillar_id, topic_id, section_id)
    );
    CREATE INDEX IF NOT EXISTS idx_guide_dogears_owner_kit
      ON guide_dogears(ownerId, kit_id);

    CREATE TABLE IF NOT EXISTS guide_highlights (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      pillar_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      quote TEXT NOT NULL,
      prefix TEXT DEFAULT '',
      suffix TEXT DEFAULT '',
      color TEXT NOT NULL DEFAULT 'amber' CHECK (color IN ('amber', 'sage', 'coral')),
      note TEXT DEFAULT '',
      card_id TEXT DEFAULT NULL REFERENCES flashcards(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_guide_highlights_owner_kit_topic
      ON guide_highlights(ownerId, kit_id, pillar_id, topic_id);
  `);
  ensureV2Indexes(db);
  db.exec(RAG_TABLES_DDL);
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
    const eps = db.prepare("SELECT id, api_key FROM custom_endpoints").all() as Array<{
      id: string;
      api_key: string | null;
    }>;
    const updEp = db.prepare("UPDATE custom_endpoints SET api_key = ? WHERE id = ?");
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

  const copyLegacy = (
    tbl: string,
    insertSql: string,
    buildArgs: (r: Record<string, unknown>, idx: number) => unknown[] | null,
  ) => {
    if (!hasTable(db, `_v1_${tbl}`)) return;
    const rows = db.prepare(`SELECT * FROM _v1_${tbl}`).all() as Array<Record<string, unknown>>;
    const ins = db.prepare(insertSql);
    rows.forEach((r, idx) => {
      const args = buildArgs(r, idx);
      if (args) ins.run(...args);
    });
  };

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const localOwnerId = ensureLocalOwnerOnDb(db);

      for (const tbl of legacyTables) {
        if (hasTable(db, tbl)) {
          db.exec("DROP INDEX IF EXISTS idx_remediation_open");
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
      copyLegacy(
        "decks",
        `INSERT INTO decks (id, ownerId, kit_id, name, description, color_index, tags, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        (r) => {
          const id = String(r.id);
          validDeckIds.add(id);
          return [
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
          ];
        },
      );

      const validCardIds = new Set<string>();
      const pendingPrereqs: Array<{ id: string; prereqId: string }> = [];
      copyLegacy(
        "flashcards",
        `INSERT INTO flashcards (
           id, ownerId, deck_id, node_id, front, back, position,
           ease_factor, interval, repetitions, next_review, last_reviewed,
           state, learning_step, prerequisite_id, embedding,
           source_pillar_id, source_topic_id, source_section_id,
           is_reverse, reverse_of_id, created_at, updated_at
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        (r) => {
          const deckId = String(r.deck_id ?? "");
          if (!validDeckIds.has(deckId)) return null;
          const id = String(r.id);
          validCardIds.add(id);
          const reps = Number(r.repetitions ?? 0);
          let state = Number(r.state ?? 0);
          if (state === 0 && reps > 0) state = 2;
          if (typeof r.prerequisite_id === "string" && r.prerequisite_id.trim()) {
            pendingPrereqs.push({ id, prereqId: r.prerequisite_id.trim() });
          }
          return [
            id,
            localOwnerId,
            deckId,
            String(r.front ?? ""),
            String(r.back ?? ""),
            Number(r.position ?? 0),
            r.ease_factor !== undefined && r.ease_factor !== null ? Number(r.ease_factor) : 2.5,
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
          ];
        },
      );

      // Only restore prerequisite_id when the referenced card still exists (eliminates orphan deadlocks).
      const updPrereq = db.prepare(
        "UPDATE flashcards SET prerequisite_id = ? WHERE ownerId = ? AND id = ?",
      );
      for (const p of pendingPrereqs) {
        if (validCardIds.has(p.prereqId) && p.prereqId !== p.id) {
          updPrereq.run(p.prereqId, localOwnerId, p.id);
        }
      }

      copyLegacy(
        "guide_content",
        `INSERT INTO guide_content (ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at, embedding)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
        (r) => [
          localOwnerId,
          kitId,
          String(r.pillar_id),
          String(r.topic_id),
          String(r.section_id),
          String(r.content ?? ""),
          r.committed_at ?? null,
          (r.embedding as string | null) ?? null,
        ],
      );

      copyLegacy(
        "chat_starters",
        `INSERT INTO chat_starters (ownerId, kit_id, pillar_id, topic_id, suggestions, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        (r) => [
          localOwnerId,
          kitId,
          String(r.pillar_id),
          String(r.topic_id),
          String(r.suggestions ?? "[]"),
          String(r.content_hash ?? ""),
          r.updated_at ?? null,
        ],
      );

      copyLegacy(
        "boards",
        `INSERT INTO boards (id, ownerId, kit_id, name, data, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        (r, idx) => [
          String(r.id),
          localOwnerId,
          kitId,
          String(r.name ?? "Untitled Board"),
          String(r.data ?? "{}"),
          r.position !== undefined && r.position !== null ? Number(r.position) : idx,
          r.created_at ?? null,
          r.updated_at ?? null,
        ],
      );

      copyLegacy(
        "chat_sessions",
        `INSERT INTO chat_sessions (id, ownerId, kit_id, name, persona, messages, pillar_id, topic_id, topic_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'socratic', ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
        (r) => [
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
        ],
      );

      copyLegacy(
        "study_sessions",
        "INSERT INTO study_sessions (ownerId, date, count) VALUES (?, ?, ?)",
        (r) => [localOwnerId, String(r.date), Number(r.count ?? 0)],
      );

      copyLegacy(
        "episodic_memory",
        `INSERT INTO episodic_memory (ownerId, kit_id, memory_text, importance_score, embedding, created_at)
         VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        (r) => [
          localOwnerId,
          kitId,
          String(r.memory_text ?? ""),
          Number(r.importance_score ?? 0),
          (r.embedding as string | null) ?? null,
          r.created_at ?? null,
        ],
      );

      copyLegacy(
        "remediation_queue",
        `INSERT INTO remediation_queue (ownerId, kit_id, card_id, source_card_id, node_id, node_name, reason, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
        (r) => {
          const cardId = String(r.card_id ?? "");
          if (!validCardIds.has(cardId)) return null;
          return [
            localOwnerId,
            kitId,
            cardId,
            String(r.source_card_id ?? ""),
            (r.node_id as string | null) ?? null,
            (r.node_name as string | null) ?? null,
            String(r.reason ?? ""),
            r.created_at ?? null,
            (r.resolved_at as string | null) ?? null,
          ];
        },
      );

      if (hasTable(db, "_v1_user_profile")) {
        const row = db.prepare("SELECT * FROM _v1_user_profile WHERE id = 1").get() as
          | Record<string, unknown>
          | undefined;
        if (row?.profile_text) {
          db.prepare(
            `INSERT INTO user_learning_profile (ownerId, profile_text, updated_at)
             VALUES (?, ?, COALESCE(?, datetime('now')))`,
          ).run(localOwnerId, String(row.profile_text), row.updated_at ?? null);
        }
      }

      for (const tbl of legacyTables) db.exec(`DROP TABLE IF EXISTS _v1_${tbl}`);
      sealPlaintextCredentialsInDb(db);
    })();
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
  ensureV2ColumnMigrations(db);

  const ownedCountsStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM kits WHERE ownerId = ?) AS kits,
      (SELECT COUNT(*) FROM decks WHERE ownerId = ?) AS decks,
      (SELECT COUNT(*) FROM flashcards WHERE ownerId = ?) AS flashcards,
      (SELECT COUNT(*) FROM guide_content WHERE ownerId = ? AND content != '' AND trim(content) != '') AS guideSections,
      (SELECT COUNT(*) FROM boards WHERE ownerId = ?) AS boards,
      (SELECT COUNT(*) FROM chat_sessions WHERE ownerId = ?) AS chatSessions
  `);
  const ownedCounts = (ownerId: string) =>
    ownedCountsStmt.get(
      ownerId,
      ownerId,
      ownerId,
      ownerId,
      ownerId,
      ownerId,
    ) as {
      kits: number;
      decks: number;
      flashcards: number;
      guideSections: number;
      boards: number;
      chatSessions: number;
    };

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
      const c = ownedCounts(local.id);
      return c.flashcards + c.guideSections + c.boards;
    },
    countItemsByOwner: () => {
      const map = new Map<string, number>();
      const addGroup = (sql: string) => {
        const rows = db.prepare(sql).all() as Array<{ ownerId: string; c: number }>;
        for (const r of rows) map.set(r.ownerId, (map.get(r.ownerId) ?? 0) + r.c);
      };
      addGroup("SELECT ownerId, COUNT(*) as c FROM flashcards GROUP BY ownerId");
      addGroup(
        "SELECT ownerId, COUNT(*) as c FROM guide_content WHERE content != '' GROUP BY ownerId",
      );
      return map;
    },
    ownedCounts,
    purgeOwnerData: (ownerId: string) => {
      if (hasTable(db, "rag_chunks_vec")) {
        ensureVecExtensionLoaded(db);
      }
      db.transaction(() => {
        // Explicit cleanup alongside ON DELETE CASCADE for thoroughness.
        db.prepare("DELETE FROM rag_chunks_fts WHERE ownerTok = ?").run(ownerTokFor(ownerId));
        if (hasTable(db, "rag_chunks_vec")) {
          const ids = db
            .prepare("SELECT chunk_id FROM rag_chunks WHERE ownerId = ?")
            .all(ownerId) as Array<{ chunk_id: string }>;
          const delVec = db.prepare(
            "DELETE FROM rag_chunks_vec WHERE ownerId = ? AND chunk_id = ?",
          );
          for (const r of ids) delVec.run(ownerId, r.chunk_id);
          db.prepare("DELETE FROM rag_chunks_vec WHERE ownerId = ?").run(ownerId);
        }
        db.prepare("DELETE FROM rag_chunks WHERE ownerId = ?").run(ownerId);
        db.prepare("DELETE FROM guide_highlights WHERE ownerId = ?").run(ownerId);
        db.prepare("DELETE FROM guide_dogears WHERE ownerId = ?").run(ownerId);
        db.prepare("DELETE FROM kits WHERE ownerId = ?").run(ownerId);
        db.prepare("DELETE FROM study_sessions WHERE ownerId = ?").run(ownerId);
        db.prepare("DELETE FROM user_learning_profile WHERE ownerId = ?").run(ownerId);
        db.prepare("DELETE FROM user_ai_settings WHERE ownerId = ?").run(ownerId);
      })();
    },
  });
}

export interface ActiveKitContext {
  id: string;
  slug: string;
  skeleton: KitSkeletonV1;
}

function parseKitSkeletonSafe(skeletonJson: string): KitSkeletonV1 {
  try {
    return JSON.parse(skeletonJson) as KitSkeletonV1;
  } catch {
    return SYSTEM_DESIGN_KIT_SKELETON;
  }
}

/**
 * Ensures the caller owns a `system-design` Kit (forked lazily from Official Shared Kits)
 * and returns its ID and parsed skeleton. Used by v1 routes until `/k/:slug` lands in M2.
 */
export function ensureDefaultSystemDesignKit(
  db: Database.Database,
  scope: Scope,
): ActiveKitContext {
  const selectExisting = db.prepare(
    "SELECT id, slug, skeleton_json FROM kits WHERE ownerId = ? AND slug = 'system-design'",
  );
  const existing = selectExisting.get(scope.ownerId) as
    | { id: string; slug: string; skeleton_json: string }
    | undefined;

  if (existing) {
    return {
      id: existing.id,
      slug: existing.slug,
      skeleton: parseKitSkeletonSafe(existing.skeleton_json),
    };
  }

  const id = crypto.randomUUID();
  const { identity } = SYSTEM_DESIGN_KIT_SKELETON;
  const shared = db
    .prepare("SELECT id, latest_version FROM shared_kits WHERE slug = 'system-design'")
    .get() as { id: string; latest_version: number } | undefined;

  const info = db
    .prepare(
      `INSERT INTO kits (
         id, ownerId, slug, name, description, icon, color, status,
         skeleton_json, forked_from_shared_id, forked_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(ownerId, slug) DO NOTHING`,
    )
    .run(
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

  if (info.changes === 0) {
    const raced = selectExisting.get(scope.ownerId) as
      | { id: string; slug: string; skeleton_json: string }
      | undefined;
    if (raced) {
      return {
        id: raced.id,
        slug: raced.slug,
        skeleton: parseKitSkeletonSafe(raced.skeleton_json),
      };
    }
  }

  return { id, slug: identity.slug, skeleton: SYSTEM_DESIGN_KIT_SKELETON };
}
