import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import logger from './utils/logger.js'

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
      embedding TEXT DEFAULT NULL,
      PRIMARY KEY (pillar_id, topic_id, section_id)
    );

    -- Shadow Memory (User Profile)
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      profile_text TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Episodic Memory Stream
    CREATE TABLE IF NOT EXISTS episodic_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_text TEXT NOT NULL,
      importance_score INTEGER DEFAULT 0,
      embedding TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
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

    -- Chat Sessions
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      messages TEXT DEFAULT '[]',
      pillar_id TEXT DEFAULT NULL,
      topic_id TEXT DEFAULT NULL,
      topic_name TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)

  logger.info('[db] Migrations complete')

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

  // Embeddings columns (additive — safe to re-run)
  try {
    db.exec(`ALTER TABLE flashcards ADD COLUMN embedding TEXT DEFAULT NULL`)
  } catch {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE guide_content ADD COLUMN embedding TEXT DEFAULT NULL`)
  } catch {
    // Column already exists
  }

  // Guide ↔ Flashcard linking columns (additive — safe to re-run)
  const guideLinkColumns = [
    ['source_pillar_id', 'TEXT DEFAULT NULL'],
    ['source_topic_id', 'TEXT DEFAULT NULL'],
    ['source_section_id', 'TEXT DEFAULT NULL'],
  ]
  for (const [col, type] of guideLinkColumns) {
    try {
      db.exec(`ALTER TABLE flashcards ADD COLUMN ${col} ${type}`)
    } catch {
      // Column already exists
    }
  }

  // Board position column (additive — safe to re-run)
  try {
    db.exec(`ALTER TABLE boards ADD COLUMN position INTEGER DEFAULT 0`)
  } catch {
    // Column already exists — ignore
  }

  // Reverse card tracking columns (additive — safe to re-run)
  const reverseColumns = [
    ['is_reverse', 'INTEGER DEFAULT 0'],
    ['reverse_of_id', 'TEXT DEFAULT NULL'],
  ]
  for (const [col, type] of reverseColumns) {
    try {
      db.exec(`ALTER TABLE flashcards ADD COLUMN ${col} ${type}`)
    } catch {
      // Column already exists
    }
  }
}

migrate()

// Seed API keys from environment variables for all registered providers.
// This iterates over PROVIDER_CLASSES and checks each provider's envKey.
// Adding a new provider to the registry automatically handles seeding.
import { seedApiKeysFromEnv } from './providers/index.js'
seedApiKeysFromEnv()

export default db

