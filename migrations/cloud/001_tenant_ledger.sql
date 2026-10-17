-- Cloud schema 1. Run as migration owner, NEVER as the web runtime role.
-- The role is NOLOGIN: create a separate LOGIN role and grant wallet_api to it.
BEGIN;
CREATE SCHEMA IF NOT EXISTS wallet;
REVOKE ALL ON SCHEMA wallet FROM PUBLIC;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wallet_api') THEN CREATE ROLE wallet_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;
CREATE FUNCTION wallet.user_id() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('finagent.user_id',true),'')::uuid $$;
CREATE FUNCTION wallet.tenant_id() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('finagent.tenant_id',true),'')::uuid $$;
CREATE TABLE wallet.workspaces(id UUID PRIMARY KEY, owner_id UUID UNIQUE NOT NULL, disabled BOOLEAN NOT NULL DEFAULT false, consent_epoch BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE wallet.memberships(tenant_id UUID NOT NULL REFERENCES wallet.workspaces(id),user_id UUID NOT NULL,role TEXT NOT NULL CHECK(role='owner'),active BOOLEAN NOT NULL DEFAULT true,PRIMARY KEY(tenant_id,user_id));
ALTER TABLE wallet.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY own_workspace ON wallet.workspaces TO wallet_api USING(owner_id=wallet.user_id()) WITH CHECK(owner_id=wallet.user_id());
ALTER TABLE wallet.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_membership ON wallet.memberships TO wallet_api USING(user_id=wallet.user_id()) WITH CHECK(user_id=wallet.user_id() AND EXISTS(SELECT 1 FROM wallet.workspaces w WHERE w.id=tenant_id AND w.owner_id=wallet.user_id() AND NOT w.disabled));
CREATE FUNCTION wallet.can_access(requested_tenant UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT requested_tenant=wallet.tenant_id() AND EXISTS(SELECT 1 FROM wallet.memberships m JOIN wallet.workspaces w ON w.id=m.tenant_id WHERE m.tenant_id=requested_tenant AND m.user_id=wallet.user_id() AND m.active AND NOT w.disabled) $$;
CREATE TABLE wallet.meta (
 key TEXT,
 value TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,key)
);

CREATE TABLE wallet.accounts (
 id TEXT,
 name TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('cash','liability')),
 currency TEXT NOT NULL,
 opened_on TEXT NOT NULL,
 mock INTEGER NOT NULL DEFAULT 0,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id)
);

CREATE TABLE wallet.drafts (
 id TEXT,
 content TEXT NOT NULL,
 evidence TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'DRAFT',
 source_key TEXT,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 account_id TEXT GENERATED ALWAYS AS (content::jsonb->>'account_id') STORED,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,source_key),
 FOREIGN KEY(tenant_id,account_id) REFERENCES wallet.accounts(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE wallet.events (
 id TEXT,
 content TEXT NOT NULL,
 source_key TEXT,
 reverses TEXT,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 account_id TEXT GENERATED ALWAYS AS (content::jsonb->>'account_id') STORED,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,source_key),
 UNIQUE(tenant_id,reverses),
 FOREIGN KEY(tenant_id,reverses) REFERENCES wallet.events(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(tenant_id,account_id) REFERENCES wallet.accounts(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE wallet.postings (
 id BIGINT GENERATED ALWAYS AS IDENTITY,
 event_id TEXT NOT NULL,
 account_ref TEXT NOT NULL,
 currency TEXT NOT NULL,
 signed_amount TEXT NOT NULL,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES wallet.events(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE wallet.challenges (
 nonce TEXT,
 purpose TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 version INTEGER NOT NULL,
 settings_version INTEGER NOT NULL,
 session_id TEXT NOT NULL,
 expires_at DOUBLE PRECISION NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,nonce)
);

CREATE TABLE wallet.idempotency (
 key TEXT,
 operation TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 response TEXT NOT NULL,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,key)
);

CREATE TABLE wallet.settings (
 key TEXT,
 content TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,key)
);

CREATE TABLE wallet.statements (
 id TEXT,
 period TEXT NOT NULL,
 version INTEGER NOT NULL,
 snapshot TEXT NOT NULL,
 artifact TEXT NOT NULL,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,period, version)
);

CREATE TABLE wallet.holdings (
 id TEXT,
 content TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id)
);

CREATE TABLE wallet.evidence (
 id TEXT,
 content TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id)
);

CREATE TABLE wallet.outbox (
 id TEXT,
 type TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 delivered INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id)
);

CREATE TABLE wallet.audit (
 id BIGINT GENERATED ALWAYS AS IDENTITY,
 action TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 at TEXT NOT NULL,
 previous_hash TEXT NOT NULL,
 hash TEXT NOT NULL,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id)
);

CREATE TABLE wallet.command_plans (
 id TEXT,
 session_ref TEXT NOT NULL,
 content TEXT NOT NULL,
 version INTEGER NOT NULL,
 status TEXT NOT NULL,
 expires_at DOUBLE PRECISION NOT NULL,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id)
);

CREATE TABLE wallet.import_batches (
 id TEXT,
 command_id TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id)
);

CREATE TABLE wallet.account_overrides (
 id TEXT,
 name TEXT NOT NULL,
 archived INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,id) REFERENCES wallet.accounts(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE wallet.investments (
 id TEXT,
 content TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 legacy_id TEXT,
 archived INTEGER NOT NULL DEFAULT 0,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,legacy_id)
);

CREATE TABLE wallet.investment_valuations (
 id TEXT,
 investment_id TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 content TEXT NOT NULL,
 version INTEGER NOT NULL,
 supersedes TEXT,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,investment_id) REFERENCES wallet.investments(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(tenant_id,supersedes) REFERENCES wallet.investment_valuations(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE wallet.investment_performance_events (
 id TEXT,
 investment_id TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 content TEXT NOT NULL,
 source_key TEXT,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,investment_id) REFERENCES wallet.investments(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE,
 UNIQUE(tenant_id,source_key)
);

CREATE TABLE wallet.reported_performance_observations (
 id TEXT,
 investment_id TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 content TEXT NOT NULL,
 version INTEGER NOT NULL,
 supersedes TEXT,
 created_at TEXT NOT NULL,
 rowid BIGINT GENERATED ALWAYS AS IDENTITY,
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,investment_id) REFERENCES wallet.investments(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(tenant_id,supersedes) REFERENCES wallet.reported_performance_observations(tenant_id,id) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE FUNCTION wallet.immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append a reversal/revision instead of updating financial history'; END $$;
CREATE TRIGGER immutable_events BEFORE UPDATE ON wallet.events FOR EACH ROW EXECUTE FUNCTION wallet.immutable_row();
CREATE TRIGGER immutable_postings BEFORE UPDATE ON wallet.postings FOR EACH ROW EXECUTE FUNCTION wallet.immutable_row();
CREATE TRIGGER immutable_investment_valuations BEFORE UPDATE ON wallet.investment_valuations FOR EACH ROW EXECUTE FUNCTION wallet.immutable_row();
CREATE TRIGGER immutable_investment_performance_events BEFORE UPDATE ON wallet.investment_performance_events FOR EACH ROW EXECUTE FUNCTION wallet.immutable_row();
CREATE TRIGGER immutable_reported_performance_observations BEFORE UPDATE ON wallet.reported_performance_observations FOR EACH ROW EXECUTE FUNCTION wallet.immutable_row();
ALTER TABLE wallet.meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.meta FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.meta TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.accounts TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.drafts TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.events FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.events TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.postings FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.postings TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.challenges TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.idempotency TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.settings FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.settings TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.statements FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.statements TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.holdings FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.holdings TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.evidence TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.outbox TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.audit FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.audit TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.command_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.command_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.command_plans TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.import_batches TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.account_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.account_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.account_overrides TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.investments FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.investments TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.investment_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.investment_valuations FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.investment_valuations TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.investment_performance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.investment_performance_events FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.investment_performance_events TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
ALTER TABLE wallet.reported_performance_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.reported_performance_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.reported_performance_observations TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));

GRANT USAGE ON SCHEMA wallet TO wallet_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA wallet TO wallet_api;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA wallet TO wallet_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wallet FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet.user_id(),wallet.tenant_id(),wallet.can_access(UUID) TO wallet_api;
COMMIT;
