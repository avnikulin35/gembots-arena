import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
const DB_PATH = path.join(__dirname, '..', 'data', 'vitalik.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER,
    username TEXT,
    first_name TEXT,
    credits INTEGER DEFAULT 50,
    family_id TEXT,
    family_role TEXT DEFAULT NULL,
    family_invite_code TEXT,
    last_bonus_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    fact TEXT NOT NULL,
    category TEXT DEFAULT 'other',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT DEFAULT 'Новый чат',
    model TEXT DEFAULT 'gigachat-lite',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model TEXT,
    credits_charged INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    gigachat_file_id TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
`);
// Migrations
try {
    db.exec(`ALTER TABLE files ADD COLUMN data BLOB`);
}
catch { }
try {
    db.exec(`ALTER TABLE files ADD COLUMN text_content TEXT`);
}
catch { }
// Cloud storage connections
try {
    db.exec(`CREATE TABLE IF NOT EXISTS cloud_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TEXT,
    folder_path TEXT DEFAULT '/',
    connected_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, provider),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
}
catch { }
// Conversation summaries cache
try {
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    messages_covered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_convsummary_session ON conversation_summaries(session_id)`);
}
catch { }
// Bookmarks & Feedback tables
try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      message_text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      message_text TEXT NOT NULL,
      rating TEXT NOT NULL CHECK(rating IN ('up', 'down')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
  `);
}
catch { }
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
`);
// Shared sessions (chat sharing via public links)
try {
    db.exec(`CREATE TABLE IF NOT EXISTS shared_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_shared_token ON shared_sessions(token)`);
}
catch { }
// Push subscriptions table
try {
    db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`);
}
catch { }
// Add notified column to reminders
try {
    db.exec(`ALTER TABLE reminders ADD COLUMN notified INTEGER DEFAULT 0`);
}
catch { }
// Add notes column to reminders
try {
    db.exec(`ALTER TABLE reminders ADD COLUMN notes TEXT`);
}
catch { }
// Add updated_at column to reminders
try {
    db.exec(`ALTER TABLE reminders ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`);
}
catch { }
// User settings table
try {
    db.exec(`CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    chat_style TEXT DEFAULT 'friendly',
    language TEXT DEFAULT 'auto',
    tts_enabled INTEGER DEFAULT 1,
    tts_voice TEXT DEFAULT 'ru-RU-DmitryNeural',
    auto_memory INTEGER DEFAULT 1,
    search_enabled INTEGER DEFAULT 1,
    suggestions_enabled INTEGER DEFAULT 1,
    font_size TEXT DEFAULT 'normal',
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
}
catch { }
// Family access
try {
    db.exec(`CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT,
  admin_id INTEGER UNIQUE,
  credits INTEGER DEFAULT 0,
  created_at INTEGER
)`);
}
catch { }
try {
    db.exec(`CREATE TABLE IF NOT EXISTS family_memories (
  id TEXT PRIMARY KEY,
  family_id TEXT,
  fact TEXT,
  category TEXT,
  created_at INTEGER
)`);
}
catch { }
try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_family_memories_family ON family_memories(family_id)`);
}
catch { }
try {
    db.exec(`ALTER TABLE users ADD COLUMN family_id TEXT`);
}
catch { }
try {
    db.exec(`ALTER TABLE users ADD COLUMN family_role TEXT DEFAULT NULL`);
}
catch { }
try {
    db.exec(`ALTER TABLE users ADD COLUMN family_invite_code TEXT`);
}
catch { }
// Add language column to user_settings (legacy DBs)
try {
    db.exec(`ALTER TABLE user_settings ADD COLUMN language TEXT DEFAULT 'auto'`);
}
catch { }
// Normalize legacy default language to new auto-detect mode
try {
    db.exec(`UPDATE user_settings SET language = 'auto' WHERE language IS NULL OR language = '' OR language = 'ru'`);
}
catch { }
export default db;
// Billing payments table (Telegram Stars)
try {
    db.exec(`CREATE TABLE IF NOT EXISTS billing_payments (
    invoice_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    invoice_payload TEXT,
    telegram_payment_charge_id TEXT,
    provider_payment_charge_id TEXT,
    status TEXT DEFAULT 'pending',
    credited INTEGER DEFAULT 0,
    paid_at TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
}
catch { }
