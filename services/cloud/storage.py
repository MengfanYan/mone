"""Private Supabase objects, accessed using the already verified USER token.

The web runtime never needs a Supabase service-role key. Uploaded bytes remain
quarantined until an isolated scanner/parser marks them clean.
"""
import base64
import hashlib
import re
from datetime import datetime, timezone
from uuid import UUID, uuid4
from urllib.parse import quote

import httpx

from services.api.domain import require


class PrivateStorage:
    def __init__(self, config, actor, token, *, client=None):
        self.config,self.actor,self.token=config,actor,token
        self.client=client or httpx.Client(timeout=15,follow_redirects=False)
    def path(self,store,object_id):
        return f"{self.actor.user_id}/{store.tenant_id}/{str(UUID(object_id))}"
    def request(self,method,path,**kwargs):
        require(re.fullmatch(r"[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}",path),"OBJECT_FORBIDDEN","Invalid private object key",403)
        try:
            endpoint="/storage/v1/object/"+("authenticated/" if method=="GET" else "")+"finagent-private/"+quote(path,safe="/")
            response=self.client.request(method,self.config.supabase_url+endpoint,headers={"apikey":self.config.supabase_key,"Authorization":"Bearer "+self.token,**kwargs.pop("headers",{})},**kwargs)
        except httpx.HTTPError:
            require(False,"STORAGE_UNAVAILABLE","Private storage is temporarily unavailable",503)
        require(response.status_code in {200,201,204},"STORAGE_UNAVAILABLE","The private file operation could not be completed",503)
        return response
    def intake(self,store,data):
        require(set(data)=={"base64","mime_type","purpose"} and isinstance(data["purpose"],str) and data["purpose"] in {"receipt","bank_statement","knowledge_document"},"INVALID_FIELDS","Choose a supported file purpose")
        require(isinstance(data["base64"],str) and len(data["base64"])<=7_000_000,"FILE_LIMIT","File exceeds the upload limit",413)
        try: raw=base64.b64decode(data["base64"],validate=True)
        except (ValueError,TypeError): require(False,"FILE_INVALID","Invalid file encoding")
        require(0<len(raw)<=5*1024*1024,"FILE_LIMIT","File size must be between 1 byte and 5 MB",413)
        mime=data["mime_type"]
        detected="image/png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if raw.startswith(b"\xff\xd8\xff") else "application/pdf" if raw.startswith(b"%PDF-") else "text/plain"
        require(mime==detected,"FILE_TYPE","The declared file type does not match its content")
        if mime=="text/plain":
            require(len(raw)<=1024*1024 and b"\x00" not in raw,"FILE_LIMIT","Text files must be valid UTF-8 and at most 1 MB")
            try: raw.decode("utf-8")
            except UnicodeError: require(False,"FILE_TYPE","The text file must use UTF-8")
        identity=str(uuid4());key=self.path(store,identity);digest=hashlib.sha256(raw).hexdigest()
        # Durable intent first: an upload timeout leaves a cleanup record instead
        # of an untracked object. Quarantine is never directly downloadable.
        with store.transaction() as db:
            db.db.execute("INSERT INTO documents(id,object_key,sha256,mime_type,size_bytes,status,purpose,expires_at) VALUES(%s,%s,%s,%s,%s,'quarantined',%s,now()+interval '24 hours')",(identity,key,digest,mime,len(raw),data["purpose"]))
            store.audit(db,"document.quarantine",identity)
        self.request("POST",key,content=raw,headers={"Content-Type":mime,"x-upsert":"false"})
        return {"id":identity,"status":"quarantined","sha256":digest,"size_bytes":len(raw),"message":"Upload saved privately. It is unavailable for analysis/download until an isolated worker validates it."}
    def download(self,store,identity):
        with store.connect() as db:
            row=db.db.execute("SELECT * FROM documents WHERE id=%s",(str(UUID(identity)),)).fetchone()
        require(row and row["status"]=="clean","RESOURCE_NOT_FOUND","This private document is unavailable or awaiting validation",404)
        require(row["object_key"]==self.path(store,identity),"OBJECT_FORBIDDEN","Object ownership mismatch",403)
        require(row["expires_at"] is None or row["expires_at"]>datetime.now(timezone.utc),"RESOURCE_NOT_FOUND","This private file expired",404)
        response=self.request("GET",row["object_key"])
        require(len(response.content)==row["size_bytes"] and hashlib.sha256(response.content).hexdigest()==row["sha256"],"OBJECT_INTEGRITY","Private file integrity check failed",409)
        return response.content
    def remove(self,store,identity):
        identity=str(UUID(identity))
        with store.connect() as db:
            row=db.db.execute("SELECT object_key,status FROM documents WHERE id=%s",(identity,)).fetchone()
        require(row and row["object_key"]==self.path(store,identity),"RESOURCE_NOT_FOUND","Private document not found",404)
        if row["status"]!="deleted":
            try:
                response=self.client.request("DELETE",self.config.supabase_url+"/storage/v1/object/finagent-private",headers={"apikey":self.config.supabase_key,"Authorization":"Bearer "+self.token},json={"prefixes":[row["object_key"]]})
            except httpx.HTTPError:
                require(False,"STORAGE_UNAVAILABLE","Private file deletion is temporarily unavailable",503)
            require(response.status_code==200,"STORAGE_UNAVAILABLE","Private file deletion could not be confirmed",503)
            with store.transaction() as db:
                db.db.execute("UPDATE documents SET status='deleted' WHERE id=%s",(identity,))
                store.audit(db,"document.delete",identity)
        return {"id":identity,"status":"deleted","ledger_changed":False}
    def close(self): self.client.close()
