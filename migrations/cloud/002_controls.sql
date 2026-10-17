BEGIN;
CREATE TABLE wallet.cloud_sessions (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 session_ref TEXT NOT NULL,user_id UUID NOT NULL,revoked BOOLEAN NOT NULL DEFAULT false,
 expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,session_ref)
);
CREATE TABLE wallet.model_challenges (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 nonce TEXT NOT NULL,content JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(tenant_id,nonce)
);
CREATE TABLE wallet.personal_rules (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 id UUID NOT NULL,merchant TEXT NOT NULL,category TEXT NOT NULL,currency TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id)
);
CREATE TABLE wallet.feedback (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 id UUID NOT NULL,kind TEXT NOT NULL,resource_id TEXT,comment TEXT NOT NULL,
 training_consent BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE wallet.documents (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 id UUID NOT NULL,object_key TEXT NOT NULL,sha256 TEXT NOT NULL,mime_type TEXT NOT NULL,
 size_bytes BIGINT NOT NULL CHECK(size_bytes>0 AND size_bytes<=5242880),status TEXT NOT NULL CHECK(status IN ('quarantined','clean','rejected','deleted')),
 purpose TEXT NOT NULL,expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,object_key)
);
CREATE TABLE wallet.jobs (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 id UUID NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,input_version BIGINT NOT NULL,
 consent_version BIGINT NOT NULL,session_ref TEXT NOT NULL,payload JSONB NOT NULL DEFAULT '{}',
 attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,
 available_at TIMESTAMPTZ NOT NULL DEFAULT now(),lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE wallet.usage_reservations (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 id UUID NOT NULL,task_id TEXT NOT NULL,period TEXT NOT NULL,units BIGINT NOT NULL CHECK(units>0),
 status TEXT NOT NULL CHECK(status IN ('reserved','settled','released','unknown')),
 actual_units BIGINT CHECK(actual_units>=0),expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,task_id)
);
CREATE TABLE wallet.usage_events (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 id UUID NOT NULL,reservation_id UUID NOT NULL,provider TEXT,provider_request_id TEXT,
 units BIGINT NOT NULL CHECK(units>=0),cost_amount NUMERIC(24,8),cost_currency TEXT,
 price_version TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,reservation_id),FOREIGN KEY(tenant_id,reservation_id) REFERENCES wallet.usage_reservations(tenant_id,id)
);
CREATE TABLE wallet.subscriptions (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 provider TEXT NOT NULL,customer_id TEXT NOT NULL,subscription_id TEXT NOT NULL,
 status TEXT NOT NULL,plan TEXT NOT NULL,period_end TIMESTAMPTZ,
 cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,provider)
);
CREATE TABLE wallet.webhook_events (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 provider TEXT NOT NULL,event_id TEXT NOT NULL,event_type TEXT NOT NULL,
 object_id TEXT NOT NULL,api_version TEXT,status TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,provider,event_id)
);
DO $$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY['cloud_sessions','model_challenges','personal_rules','feedback','documents','jobs','usage_reservations','usage_events','subscriptions','webhook_events'] LOOP
  EXECUTE format('ALTER TABLE wallet.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE wallet.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY private_rows ON wallet.%I TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id))',table_name);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA wallet TO wallet_api;
COMMIT;
