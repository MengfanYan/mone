"""Independent, signed erasure fences. No ledger text, amounts or email addresses.

Production uses a SECOND control project, excluded from financial DB restores.
The file adapter is for isolated restore tests/operator-controlled offline drills.
"""
import base64
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
from urllib.parse import quote

import httpx

from services.api.domain import Problem, canonical, require


class Signer:
    def __init__(self, keys, active):
        require(active in keys and all(isinstance(k,bytes) and len(k)>=32 for k in keys.values()),"JOURNAL_CONFIG","Deletion control signing keys are not configured",503)
        self.keys,self.active=keys,active
    def tenant_hash(self,tenant,key_id=None):
        return hmac.new(self.keys[key_id or self.active],("tenant:"+str(tenant)).encode(),hashlib.sha256).hexdigest()
    def sign(self,tenant,request_id,generation):
        require(isinstance(request_id,str) and re.fullmatch(r"[a-f0-9]{64}",request_id) and isinstance(generation,int) and generation>0,"JOURNAL_RECORD","Invalid deletion request")
        value={"schema":1,"key_id":self.active,"tenant_hash":self.tenant_hash(tenant),"request_id":request_id,"generation":generation,"scope":"all_private_application_data"}
        return {**value,"signature":hmac.new(self.keys[self.active],canonical(value).encode(),hashlib.sha256).hexdigest()}
    def verify(self,value,tenant):
        require(isinstance(value,dict) and set(value)=={"schema","key_id","tenant_hash","request_id","generation","scope","signature"},"JOURNAL_INTEGRITY","Deletion receipt is malformed",409)
        key=self.keys.get(value["key_id"])
        require(key and value["schema"]==1 and value["scope"]=="all_private_application_data" and isinstance(value["generation"],int) and value["generation"]>0,"JOURNAL_INTEGRITY","Deletion receipt has unknown signing metadata",409)
        unsigned={k:v for k,v in value.items() if k!="signature"}
        expected=hmac.new(key,canonical(unsigned).encode(),hashlib.sha256).hexdigest()
        require(isinstance(value["signature"],str) and hmac.compare_digest(expected,value["signature"]) and value["tenant_hash"]==self.tenant_hash(tenant,value["key_id"]),"JOURNAL_INTEGRITY","Deletion receipt authentication failed",409)
        return value["generation"]


class FileJournal:
    def __init__(self,root,signer):
        self.root,self.signer=Path(root),signer
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        manifest=self.root/"_required_keys.json"
        if not manifest.exists():manifest.write_text(canonical({"required_key_ids":list(signer.keys)}))
    def check_keys(self):
        required=json.loads((self.root/"_required_keys.json").read_text())["required_key_ids"]
        require(set(required)<=set(self.signer.keys),"JOURNAL_KEYS_MISSING","Historical deletion verification keys are missing",503)
    def record(self,tenant,request_id,generation):
        self.check_keys()
        manifest=self.root/"_required_keys.json"
        required=set(json.loads(manifest.read_text())["required_key_ids"])|set(self.signer.keys)
        manifest.write_text(canonical({"required_key_ids":sorted(required)}))
        value=self.signer.sign(tenant,request_id,generation)
        folder=self.root/value["tenant_hash"];folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        path=folder/(request_id+".json")
        try:
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,"w") as f:f.write(canonical(value));f.flush();os.fsync(f.fileno())
        except FileExistsError:
            require(self.signer.verify(json.loads(path.read_text()),tenant)==generation,"JOURNAL_INTEGRITY","Deletion retry changed its generation",409)
        return value
    def generation(self,tenant):
        self.check_keys()
        values=[]
        for key in self.signer.keys:
            folder=self.root/self.signer.tenant_hash(tenant,key)
            if folder.exists():values.extend(self.signer.verify(json.loads(p.read_text()),tenant) for p in folder.glob("*.json"))
        return max(values,default=0)


class ControlJournal:
    bucket="finagent-deletion-control"
    def __init__(self,url,key,signer,finance_url,*,client=None):
        require(re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co",url or "") and url!=finance_url and key,"JOURNAL_CONFIG","Use an independent deletion-control project",503)
        self.url,self.key,self.signer=url,key,signer
        self.client=client or httpx.Client(timeout=10,follow_redirects=False)
    def request(self,method,path,**kwargs):
        try:r=self.client.request(method,self.url+"/storage/v1/"+path,headers={"apikey":self.key,"Authorization":"Bearer "+self.key,**kwargs.pop("headers",{})},**kwargs)
        except httpx.HTTPError:require(False,"JOURNAL_UNAVAILABLE","Independent deletion control is unavailable; no database deletion was committed",503)
        return r
    def record(self,tenant,request_id,generation):
        self.check_keys()
        value=self.signer.sign(tenant,request_id,generation)
        info=self.request("GET","bucket/"+self.bucket)
        require(info.status_code==200 and info.json().get("public") is False,"JOURNAL_CONFIG","Deletion-control bucket must be private",503)
        key=f"deletions/{value['tenant_hash']}/{request_id}.json"
        r=self.request("POST","object/"+self.bucket+"/"+key,content=canonical(value).encode(),headers={"Content-Type":"application/json","x-upsert":"false"})
        if r.status_code in {400,409}:
            old=self.request("GET","object/authenticated/"+self.bucket+"/"+key)
            require(old.status_code==200 and self.signer.verify(old.json(),tenant)==generation,"JOURNAL_INTEGRITY","Existing deletion receipt does not match",409)
        else:require(r.status_code in {200,201},"JOURNAL_UNAVAILABLE","Deletion receipt was not durably accepted",503)
        return value
    def generation(self,tenant):
        self.check_keys()
        result=0
        for key_id in self.signer.keys:
            prefix="deletions/"+self.signer.tenant_hash(tenant,key_id)
            offset=0
            while True:
                r=self.request("POST","object/list/"+self.bucket,json={"prefix":prefix,"limit":1000,"offset":offset})
                require(r.status_code==200 and isinstance(r.json(),list),"JOURNAL_UNAVAILABLE","Cannot verify deletion control before restoring",503)
                rows=r.json()
                for row in rows:
                    require(re.fullmatch(r"[a-f0-9]{64}\.json",row.get("name","")),"JOURNAL_INTEGRITY","Unexpected deletion object",409)
                    receipt=self.request("GET","object/authenticated/"+self.bucket+"/"+quote(prefix+"/"+row["name"],safe="/"))
                    require(receipt.status_code==200,"JOURNAL_UNAVAILABLE","Deletion receipt is missing",503)
                    result=max(result,self.signer.verify(receipt.json(),tenant))
                if len(rows)<1000:break
                offset+=1000
                require(offset<=100000,"JOURNAL_LIMIT","Deletion log requires operator review",503)
        return result
    def check_keys(self):
        response=self.request("GET","object/authenticated/"+self.bucket+"/key-manifest.json")
        require(response.status_code==200,"JOURNAL_CONFIG","The independent deletion key manifest is missing",503)
        value=response.json()
        require(isinstance(value,dict) and isinstance(value.get("required_key_ids"),list) and self.signer.active in value["required_key_ids"] and set(value["required_key_ids"])<=set(self.signer.keys),"JOURNAL_KEYS_MISSING","Historical deletion verification keys are missing or the rotation manifest is incomplete",503)
    def close(self): self.client.close()


def from_env(finance_url):
    try:
        raw=json.loads(os.environ.get("CLOUD_DELETION_KEYS_JSON","{}"))
        keys={name:base64.b64decode(value,validate=True) for name,value in raw.items()}
        signer=Signer(keys,os.environ.get("CLOUD_DELETION_ACTIVE_KEY",""))
        return ControlJournal(os.environ.get("CLOUD_JOURNAL_SUPABASE_URL",""),os.environ.get("CLOUD_JOURNAL_SERVICE_KEY",""),signer,finance_url)
    except (ValueError,TypeError,Problem):
        return None
