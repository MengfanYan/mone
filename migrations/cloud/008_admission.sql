-- Operator-managed closed-preview admission. Application users cannot create invitations.
BEGIN;
CREATE SCHEMA wallet_admission;
REVOKE ALL ON SCHEMA wallet_admission FROM PUBLIC;
CREATE TABLE wallet_admission.invites(user_id UUID PRIMARY KEY,expires_at TIMESTAMPTZ NOT NULL,approved_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE wallet_admission.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_admission.invites FORCE ROW LEVEL SECURITY;
CREATE POLICY own_invitation ON wallet_admission.invites FOR SELECT TO wallet_api USING(user_id=wallet.user_id());
GRANT USAGE ON SCHEMA wallet_admission TO wallet_api;
GRANT SELECT ON wallet_admission.invites TO wallet_api;
COMMIT;
