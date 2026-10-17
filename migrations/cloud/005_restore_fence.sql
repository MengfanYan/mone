BEGIN;
ALTER TABLE wallet.workspaces ADD COLUMN reauth_after TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0);
COMMIT;
