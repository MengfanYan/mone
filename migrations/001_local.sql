PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta VALUES ('schema_version', '1');
INSERT OR IGNORE INTO meta VALUES ('ledger_version', '0');
INSERT OR IGNORE INTO meta VALUES ('settings_version', '0');
INSERT OR IGNORE INTO meta VALUES ('resource_version', '0');
INSERT OR IGNORE INTO meta VALUES ('market_last_refresh', '0');
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('cash','liability')),
 currency TEXT NOT NULL, opened_on TEXT NOT NULL, mock INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS drafts (
 id TEXT PRIMARY KEY, content TEXT NOT NULL, evidence TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT',
 source_key TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, content TEXT NOT NULL, source_key TEXT UNIQUE,
 reverses TEXT UNIQUE REFERENCES events(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS postings (
 id INTEGER PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 account_ref TEXT NOT NULL, currency TEXT NOT NULL, signed_amount TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
 nonce TEXT PRIMARY KEY, purpose TEXT NOT NULL, resource_id TEXT NOT NULL,
 content_hash TEXT NOT NULL, version INTEGER NOT NULL, settings_version INTEGER NOT NULL,
 session_id TEXT NOT NULL, expires_at REAL NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS idempotency (
 key TEXT PRIMARY KEY, operation TEXT NOT NULL, request_hash TEXT NOT NULL,
 response TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, content TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES ('planning', '{}');
INSERT OR IGNORE INTO settings VALUES ('consents', '{"analysis":false,"ocr":false}');
CREATE TABLE IF NOT EXISTS statements (
 id TEXT PRIMARY KEY, period TEXT NOT NULL, version INTEGER NOT NULL,
 snapshot TEXT NOT NULL, artifact TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(period, version)
);
CREATE TABLE IF NOT EXISTS holdings (id TEXT PRIMARY KEY, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, resource_id TEXT NOT NULL,
 version INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY, action TEXT NOT NULL, resource_id TEXT NOT NULL,
 at TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_event BEFORE UPDATE ON events
 BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_posting BEFORE UPDATE ON postings
 BEGIN SELECT RAISE(ABORT, 'postings are immutable'); END;
