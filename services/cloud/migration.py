"""Explicit, atomic import of an operator-exported local archive into ONE owner.

No email guessing, old sessions, confirmation tokens or processing grants migrate.
"""
import hashlib
import json

from services.api.domain import canonical, require, money, postings, validate_event, valid_date
from services.api.experience import NEW_TABLES
from services.cloud.store import COLUMNS

TABLES=("accounts","drafts","events","postings","settings","statements","holdings","evidence")+NEW_TABLES


def inspect_event_postings(data):
    """A balanced archive can still lie about the amount shown to its owner."""
    from decimal import Decimal
    accounts = {row["id"]: {**row, "archived": False} for row in data.get("accounts", [])}
    events = {row["id"]: row for row in data.get("events", [])}
    require(len(events) == len(data.get("events", [])), "MIGRATION_EVENT", "Duplicate event IDs are not allowed")
    contents = {}
    for event_id, row in events.items():
        try:
            content = json.loads(row["content"])
        except (TypeError, ValueError):
            require(False, "MIGRATION_EVENT", "Event content is not valid JSON")
        require(isinstance(content, dict), "MIGRATION_EVENT", "Event content must be an object")
        contents[event_id] = content
    actual = {event_id: [] for event_id in events}
    for row in data.get("postings", []):
        content = contents[row["event_id"]]
        require(row["currency"] == content.get("currency"), "MIGRATION_EVENT", "Posting and event currencies differ")
        actual[row["event_id"]].append((row["account_ref"], Decimal(row["signed_amount"])))
    fields = ("kind", "amount", "currency", "date", "merchant", "category", "account_id", "counterparty_id", "refund_of", "external_id", "mock")
    for event_id, row in events.items():
        content = contents[event_id]
        account = accounts.get(content.get("account_id"))
        require(account is not None and account["currency"] == content.get("currency"), "MIGRATION_EVENT", "Event account or currency is invalid")
        valid_date(content.get("date"))
        amount = money(content.get("amount"), content.get("currency"), positive=True)
        if row["reverses"]:
            original = events.get(row["reverses"])
            require(original is not None and not original["reverses"] and contents[original["id"]].get("kind") != "opening", "MIGRATION_EVENT", "Invalid reversal reference")
            require(content.get("direction") == "-1" and all(content.get(k) == contents[original["id"]].get(k) for k in fields), "MIGRATION_EVENT", "Reversal content differs from its original event")
            expected = [(ref, -value) for ref, value in actual[original["id"]]]
        elif content.get("kind") == "opening":
            require(content.get("direction", "1") == "1", "MIGRATION_EVENT", "Invalid opening direction")
            signed = -amount if account["type"] == "liability" else amount
            expected = [(account["id"], signed), ("equity:opening", -signed)]
        else:
            require(content.get("direction", "1") == "1", "MIGRATION_EVENT", "Invalid event direction")
            event = validate_event({k: content[k] for k in fields if k in content}, accounts)
            expected = [(ref, Decimal(value)) for ref, value in postings(event)]
        require(sorted(actual[event_id]) == sorted(expected), "MIGRATION_EVENT", "Event content and exact source postings differ")


def inspect_archive(archive):
    require(isinstance(archive,dict) and archive.get("schema_version")=="2" and isinstance(archive.get("data"),dict),"MIGRATION_SCHEMA","Export a schema-2 local archive first")
    data=archive["data"]
    require(set(data)<=set(TABLES)|{"idempotency"},"MIGRATION_SCHEMA","Archive contains unsupported data tables")
    for name in TABLES:
        rows=data.get(name,[])
        require(isinstance(rows,list) and len(rows)<=100000,"MIGRATION_LIMIT","Archive table exceeds import limits")
        for row in rows:
            require(isinstance(row,dict) and set(row)==set(COLUMNS[name]),"MIGRATION_SCHEMA","Archive row fields are incomplete or incompatible")
    # Financial invariants checked before any cloud mutation.
    from decimal import Decimal
    totals={}
    events={e["id"] for e in data.get("events",[])}
    for row in data.get("postings",[]):
        require(row["event_id"] in events,"MIGRATION_ORPHAN","A posting has no original event")
        key=(row["event_id"],row["currency"])
        value=money(row["signed_amount"],row["currency"])
        require(value.is_finite(),"MIGRATION_AMOUNT","A posting amount is invalid")
        totals[key]=totals.get(key,Decimal(0))+value
    require(all(value==0 for value in totals.values()) and {key[0] for key in totals}==events,"MIGRATION_UNBALANCED","Every event must have balanced source postings")
    inspect_event_postings(data)
    return {"source_hash":hashlib.sha256(canonical(archive).encode()).hexdigest(),"counts":{t:len(data.get(t,[])) for t in TABLES},"reset_processing_consents":True,"migrated_sessions":0,"migrated_confirmation_tokens":0}


def import_archive(store, archive, authorize=None):
    manifest=inspect_archive(archive)
    with store.transaction() as db:
        if authorize: authorize(db)
        old=db.db.execute("SELECT manifest FROM migration_receipts WHERE source_hash=%s",(manifest["source_hash"],)).fetchone()
        if old: return {**old["manifest"],"replayed":True}
        require(db.execute("SELECT count(*) FROM accounts").fetchone()[0]==0 and db.execute("SELECT count(*) FROM events").fetchone()[0]==0,"MIGRATION_NOT_EMPTY","Import requires a new, empty cloud ledger",409)
        db.db.execute("SET CONSTRAINTS ALL DEFERRED")
        for table in TABLES:
            if table in {"settings","command_plans","import_batches"}: continue
            for row in archive["data"].get(table,[]):
                # Identity integers are not portable. Postings keep event references;
                # cloud-generated audit/posting sequences remain independent.
                columns=[c for c in COLUMNS[table] if c in row and not(table=="postings" and c=="id")]
                db.db.execute(f"INSERT INTO {table}({','.join(columns)}) VALUES({','.join(['%s']*len(columns))})",tuple(row[c] for c in columns))
        for row in archive["data"].get("settings",[]):
            if row["key"] in {"planning","terminal"}:
                db.execute("INSERT INTO settings(key,content) VALUES(?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET content=excluded.content",(row["key"],row["content"]))
        db.execute("UPDATE settings SET content=? WHERE key='consents'",(canonical({"analysis":False,"ocr":False}),))
        store.bump(db);store.bump(db,"settings_version");store.bump(db,"portfolio_version")
        # Check exact source and target monetary posting totals independently by account.
        from decimal import Decimal
        expected={}
        for row in archive["data"].get("postings",[]):
            key=(row["account_ref"],row["currency"])
            expected[key]=expected.get(key,Decimal(0))+Decimal(row["signed_amount"])
        actual={}
        for row in db.execute("SELECT account_ref,currency,signed_amount FROM postings"):
            key=(row["account_ref"],row["currency"])
            actual[key]=actual.get(key,Decimal(0))+Decimal(row["signed_amount"])
        require(expected==actual,"MIGRATION_RECONCILIATION","Posting totals do not match; import was rolled back",409)
        for table in (t for t in TABLES if t not in {"settings","command_plans","import_batches"}):
            require(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]==manifest["counts"][table],"MIGRATION_RECONCILIATION","Source and target counts differ",409)
        manifest.update(status="IMPORTED_RECONCILED",amount_difference="0",posting_ids="regenerated; event IDs preserved",excluded_tables=["sessions","challenges","idempotency","command_plans","import_batches"])
        db.db.execute("INSERT INTO migration_receipts(source_hash,manifest) VALUES(%s,%s)",(manifest["source_hash"],json.dumps(manifest)))
        store.audit(db,"migration.import",manifest["source_hash"])
    return manifest
