import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { LOCAL_OWNER_EMAIL } from "../appConfig.ts";
import { initPlatformSchema } from "../platform/db/platformSchema.ts";
import { initKitsSchema, openCredential } from "../kits/kitsSchema.ts";

describe("Legacy v1 single-user SQLite -> Multi-tenant v2 automatic upgrade", () => {
  it("preserves 100% of v1 rows, cleans orphan prerequisite_ids, and seals API keys", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");

    // 1. Seed a genuine v1 single-user schema + user study data
    db.exec(`
      CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE custom_endpoints (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT DEFAULT '');
      CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', color_index INTEGER DEFAULT 0, tags TEXT DEFAULT '', settings TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT);
      CREATE TABLE flashcards (
        id TEXT PRIMARY KEY, deck_id TEXT NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL,
        position INTEGER DEFAULT 0, ease_factor REAL DEFAULT 2.5, interval INTEGER DEFAULT 0,
        repetitions INTEGER DEFAULT 0, next_review TEXT, last_reviewed TEXT, state INTEGER DEFAULT 0,
        learning_step INTEGER DEFAULT 0, prerequisite_id TEXT, embedding TEXT,
        source_pillar_id TEXT, source_topic_id TEXT, source_section_id TEXT,
        is_reverse INTEGER DEFAULT 0, reverse_of_id TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE guide_content (pillar_id TEXT NOT NULL, topic_id TEXT NOT NULL, section_id TEXT NOT NULL, content TEXT NOT NULL, committed_at TEXT, PRIMARY KEY (pillar_id, topic_id, section_id));
      CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
      CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, persona TEXT DEFAULT 'interviewer', topic_context_json TEXT, messages_json TEXT NOT NULL, created_at TEXT, updated_at TEXT);
      CREATE TABLE study_sessions (date TEXT PRIMARY KEY, count INTEGER DEFAULT 0);
      CREATE TABLE user_profile (id INTEGER PRIMARY KEY CHECK (id = 1), profile_text TEXT NOT NULL DEFAULT '', updated_at TEXT);
    `);

    db.prepare("INSERT INTO config (key, value) VALUES ('gemini_api_key', 'AIzaPlaintextLegacyKey123')").run();
    db.prepare("INSERT INTO custom_endpoints (id, name, base_url, api_key) VALUES ('ep-1', 'Ollama', 'http://localhost:11434/v1', 'plain-ep-secret')").run();
    db.prepare("INSERT INTO decks (id, name, description) VALUES ('deck-legacy', 'Distributed Consensus', 'Raft & Paxos')").run();

    // Card 1: valid root card; Card 2: depends on Card 1; Card 3: orphan prerequisite_id pointing to deleted card!
    db.prepare("INSERT INTO flashcards (id, deck_id, front, back, state, ease_factor) VALUES ('card-1', 'deck-legacy', 'What is Raft?', 'Consensus protocol', 2, 2.6)").run();
    db.prepare("INSERT INTO flashcards (id, deck_id, front, back, prerequisite_id) VALUES ('card-2', 'deck-legacy', 'Leader election?', 'Term + heartbeat', 'card-1')").run();
    db.prepare("INSERT INTO flashcards (id, deck_id, front, back, prerequisite_id) VALUES ('card-3', 'deck-legacy', 'Log compaction?', 'Snapshotting', 'deleted-ghost-card-id')").run();

    db.prepare("INSERT INTO guide_content (pillar_id, topic_id, section_id, content) VALUES ('distributed', 'consensus', 'overview', '# Raft Notes')").run();
    db.prepare("INSERT INTO boards (id, name, data) VALUES ('board-1', 'URL Shortener', '{\"nodes\":[]}')").run();
    db.prepare("INSERT INTO chat_sessions (id, title, messages_json) VALUES ('sess-1', 'CAP Deep Dive', '[{\"role\":\"user\",\"content\":\"Hi\"}]')").run();
    db.prepare("INSERT INTO study_sessions (date, count) VALUES ('2026-11-01', 14)").run();
    db.prepare("INSERT INTO user_profile (id, profile_text) VALUES (1, 'Staff backend engineer')").run();

    // 2. Run v2 platform + kits schema upgrade
    initPlatformSchema(db);
    initKitsSchema(db);

    // 3. Verify zero foreign key violations
    const fkViolations = db.pragma("foreign_key_check") as unknown[];
    expect(fkViolations).toEqual([]);

    // 4. Verify local owner + Official System Design shared kit + personal kit
    const localOwner = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(LOCAL_OWNER_EMAIL) as { id: string } | undefined;
    expect(localOwner).toBeDefined();

    const sharedKit = db
      .prepare("SELECT slug, is_official FROM shared_kits WHERE slug = 'system-design'")
      .get() as { slug: string; is_official: number } | undefined;
    expect(sharedKit).toEqual({ slug: "system-design", is_official: 1 });

    const personalKit = db
      .prepare("SELECT id, slug FROM kits WHERE ownerId = ?")
      .get(localOwner!.id) as { id: string; slug: string } | undefined;
    expect(personalKit?.slug).toBe("system-design");

    // 5. Verify all v1 study rows survived under (localOwner.id, personalKit.id)
    const cards = db
      .prepare("SELECT id, prerequisite_id FROM flashcards WHERE ownerId = ? ORDER BY id ASC")
      .all(localOwner!.id) as Array<{ id: string; prerequisite_id: string | null }>;
    expect(cards).toEqual([
      { id: "card-1", prerequisite_id: null },
      { id: "card-2", prerequisite_id: "card-1" },
      { id: "card-3", prerequisite_id: null }, // Orphan prerequisite healed!
    ]);

    const note = db
      .prepare("SELECT content FROM guide_content WHERE ownerId = ? AND kit_id = ?")
      .get(localOwner!.id, personalKit!.id) as { content: string } | undefined;
    expect(note?.content).toBe("# Raft Notes");

    const profile = db
      .prepare("SELECT profile_text FROM user_learning_profile WHERE ownerId = ?")
      .get(localOwner!.id) as { profile_text: string } | undefined;
    expect(profile?.profile_text).toBe("Staff backend engineer");

    const streak = db
      .prepare("SELECT count FROM study_sessions WHERE ownerId = ? AND date = '2026-11-01'")
      .get(localOwner!.id) as { count: number } | undefined;
    expect(streak?.count).toBe(14);

    // 6. Verify plaintext API keys were sealed at rest and round-trip cleanly
    const storedGem = db
      .prepare("SELECT value FROM config WHERE key = 'gemini_api_key'")
      .get() as { value: string };
    expect(storedGem.value.startsWith("v1:")).toBe(true);
    expect(openCredential(storedGem.value)).toBe("AIzaPlaintextLegacyKey123");

    const storedEp = db
      .prepare("SELECT api_key FROM custom_endpoints WHERE id = 'ep-1'")
      .get() as { api_key: string };
    expect(storedEp.api_key.startsWith("v1:")).toBe(true);
    expect(openCredential(storedEp.api_key)).toBe("plain-ep-secret");

    db.close();
  });
});
