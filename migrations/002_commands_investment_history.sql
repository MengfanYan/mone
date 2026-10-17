BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS command_plans (
 id TEXT PRIMARY KEY, session_ref TEXT NOT NULL, content TEXT NOT NULL,
 version INTEGER NOT NULL, status TEXT NOT NULL, expires_at REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_batches (
 id TEXT PRIMARY KEY, command_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_overrides (
 id TEXT PRIMARY KEY REFERENCES accounts(id), name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS investments (
 id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, legacy_id TEXT UNIQUE, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS investment_valuations (
 id TEXT PRIMARY KEY, investment_id TEXT NOT NULL REFERENCES investments(id), observed_at TEXT NOT NULL,
 content TEXT NOT NULL, version INTEGER NOT NULL, supersedes TEXT REFERENCES investment_valuations(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS investment_performance_events (
 id TEXT PRIMARY KEY, investment_id TEXT NOT NULL REFERENCES investments(id), observed_at TEXT NOT NULL,
 content TEXT NOT NULL, source_key TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reported_performance_observations (
 id TEXT PRIMARY KEY, investment_id TEXT NOT NULL REFERENCES investments(id), observed_at TEXT NOT NULL,
 content TEXT NOT NULL, version INTEGER NOT NULL, supersedes TEXT REFERENCES reported_performance_observations(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS investment_valuation_time ON investment_valuations(investment_id,observed_at,version);
CREATE INDEX IF NOT EXISTS investment_performance_time ON investment_performance_events(investment_id,observed_at);
CREATE INDEX IF NOT EXISTS reported_observation_time ON reported_performance_observations(investment_id,observed_at,version);
CREATE TRIGGER IF NOT EXISTS valuation_no_update BEFORE UPDATE ON investment_valuations BEGIN SELECT RAISE(ABORT,'immutable valuation: append a revision'); END;
CREATE TRIGGER IF NOT EXISTS performance_no_update BEFORE UPDATE ON investment_performance_events BEGIN SELECT RAISE(ABORT,'immutable performance event'); END;
CREATE TRIGGER IF NOT EXISTS observation_no_update BEFORE UPDATE ON reported_performance_observations BEGIN SELECT RAISE(ABORT,'immutable observation: append a revision'); END;
INSERT OR IGNORE INTO meta VALUES ('portfolio_version','0');
UPDATE meta SET value='2' WHERE key='schema_version';
COMMIT;
