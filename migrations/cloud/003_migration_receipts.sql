BEGIN;
CREATE TABLE wallet.migration_receipts (
 tenant_id UUID NOT NULL DEFAULT wallet.tenant_id() REFERENCES wallet.workspaces(id),
 source_hash TEXT NOT NULL,manifest JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,source_hash)
);
ALTER TABLE wallet.migration_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.migration_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY private_rows ON wallet.migration_receipts TO wallet_api USING(wallet.can_access(tenant_id)) WITH CHECK(wallet.can_access(tenant_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON wallet.migration_receipts TO wallet_api;
COMMIT;
