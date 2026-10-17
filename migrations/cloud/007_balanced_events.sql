BEGIN;
CREATE FUNCTION wallet.assert_balanced_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,wallet AS $$
DECLARE target_event TEXT; target_tenant UUID; row_count BIGINT; net NUMERIC; currencies BIGINT; declared_currency TEXT; posted_currency TEXT;
BEGIN
 IF TG_TABLE_NAME='events' THEN target_event:=COALESCE(NEW.id,OLD.id); ELSE target_event:=COALESCE(NEW.event_id,OLD.event_id); END IF;
 target_tenant:=COALESCE(NEW.tenant_id,OLD.tenant_id);
 SELECT e.content::jsonb->>'currency' INTO declared_currency FROM wallet.events e WHERE e.tenant_id=target_tenant AND e.id=target_event;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT count(*),COALESCE(sum(p.signed_amount),0),count(DISTINCT p.currency),min(p.currency) INTO row_count,net,currencies,posted_currency FROM wallet.postings p WHERE p.tenant_id=target_tenant AND p.event_id=target_event;
 IF row_count<2 OR net<>0 OR currencies<>1 OR posted_currency<>declared_currency THEN
  RAISE EXCEPTION 'Event postings must balance in their declared currency' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced_event_insert AFTER INSERT ON wallet.events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet.assert_balanced_event();
CREATE CONSTRAINT TRIGGER balanced_posting_change AFTER INSERT OR DELETE ON wallet.postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet.assert_balanced_event();
REVOKE ALL ON FUNCTION wallet.assert_balanced_event() FROM PUBLIC;
COMMIT;
