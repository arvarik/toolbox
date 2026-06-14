import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DB_PATH || './data/toolbox.db'

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new Database(DB_PATH)

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/**
 * Run database migrations to create tables.
 */
function migrate() {
  db.exec(`
    -- Application configuration (API keys, preferences)
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Flashcard decks
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color_index INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Flashcards within decks
    CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    -- Whiteboard boards
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Study sessions (for heatmap)
    CREATE TABLE IF NOT EXISTS study_sessions (
      date TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0
    );

    -- Guide content — committed learning notes per section
    CREATE TABLE IF NOT EXISTS guide_content (
      pillar_id   TEXT NOT NULL,
      topic_id    TEXT NOT NULL,
      section_id  TEXT NOT NULL,
      content     TEXT DEFAULT '',
      committed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (pillar_id, topic_id, section_id)
    );

    -- Shadow Memory (User Profile)
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      profile_text TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- AI Generated Chat Starters
    CREATE TABLE IF NOT EXISTS chat_starters (
      pillar_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      suggestions TEXT DEFAULT '[]',
      content_hash TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (pillar_id, topic_id)
    );
  `)

  console.log('[db] Migrations complete')

  // SRS columns migration (additive — safe to re-run)
  const srsColumns = [
    ['ease_factor', 'REAL DEFAULT 2.5'],
    ['interval', 'INTEGER DEFAULT 0'],
    ['repetitions', 'INTEGER DEFAULT 0'],
    ['next_review', 'TEXT DEFAULT NULL'],
    ['last_reviewed', 'TEXT DEFAULT NULL'],
    ['state', 'INTEGER DEFAULT 0'],
    ['learning_step', 'INTEGER DEFAULT 0'],
  ]
  for (const [col, type] of srsColumns) {
    try {
      db.exec(`ALTER TABLE flashcards ADD COLUMN ${col} ${type}`)
    } catch {
      // Column already exists — ignore
    }
  }

  // Tags column for decks (additive — safe to re-run)
  try {
    db.exec(`ALTER TABLE decks ADD COLUMN tags TEXT DEFAULT ''`)
  } catch {
    // Column already exists — ignore
  }

  // Settings column for decks (additive — safe to re-run)
  try {
    db.exec(`ALTER TABLE decks ADD COLUMN settings TEXT DEFAULT '{}'`)
  } catch {
    // Column already exists — ignore
  }

  // Migrate already reviewed cards to state = 2 (Review) if they were at state = 0
  try {
    db.exec(`UPDATE flashcards SET state = 2 WHERE state = 0 AND repetitions > 0`)
  } catch {
    // Ignore migration error or if it's already run
  }

  // Knowledge Prerequisites (additive — safe to re-run)
  try {
    db.exec(`ALTER TABLE flashcards ADD COLUMN prerequisite_id TEXT DEFAULT NULL`)
  } catch {
    // Column already exists
  }
}

migrate()

// Seed Gemini API key from environment variable if present and not already stored
if (process.env.GEMINI_API_KEY) {
  const existing = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!existing?.value) {
    db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES ('gemini_api_key', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(process.env.GEMINI_API_KEY)
    console.log('[db] Seeded Gemini API key from environment')
  }
}

export default db
