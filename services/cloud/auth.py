import hashlib
import time
from dataclasses import dataclass
from uuid import UUID

import httpx
import jwt

from services.api.domain import require


@dataclass(frozen=True)
class Actor:
    user_id: str
    session_ref: str
    email: str
    claims: dict
    factors: tuple = ()


class SupabaseIdentity:
    def __init__(self, config):
        self.config = config
        self.jwks = jwt.PyJWKClient(config.supabase_url+"/auth/v1/.well-known/jwks.json",cache_jwk_set=True,lifespan=300,timeout=8)

    def verify(self, token):
        require(isinstance(token,str) and 0<len(token)<20000,"UNAUTHENTICATED","Sign in to your cloud account",401)
        try:
            # Only asymmetric project signing keys; never accept client alg=none/HS256.
            key=self.jwks.get_signing_key_from_jwt(token)
            claims=jwt.decode(token,key.key,algorithms=["ES256","RS256"],issuer=self.config.supabase_url+"/auth/v1",audience="authenticated",options={"require":["exp","iat","sub","iss","aud","session_id"]},leeway=15)
            user_id=str(UUID(claims["sub"]));session=str(UUID(claims["session_id"]))
        except (jwt.PyJWTError,ValueError,KeyError):
            require(False,"UNAUTHENTICATED","The cloud session is invalid or expired",401)
        try:
            response=httpx.get(self.config.supabase_url+"/auth/v1/user",headers={"apikey":self.config.supabase_key,"Authorization":"Bearer "+token},timeout=8,follow_redirects=False)
            user=response.json() if response.status_code==200 else {}
        except (httpx.HTTPError,ValueError):
            require(False,"AUTH_UNAVAILABLE","Identity service is temporarily unavailable",503)
        require(user.get("id")==user_id and not user.get("is_anonymous") and (user.get("email_confirmed_at") or user.get("phone_confirmed_at")),"UNAUTHENTICATED","A verified account is required",401)
        return Actor(user_id,hashlib.sha256(session.encode()).hexdigest(),user.get("email",""),claims,tuple(user.get("factors") or []))

    def reauthenticate(self, actor, password):
        require(isinstance(password,str) and 1<=len(password)<=200,"REAUTH_REQUIRED","Re-enter your account password",401)
        try:
            response=httpx.post(self.config.supabase_url+"/auth/v1/token?grant_type=password",headers={"apikey":self.config.supabase_key},json={"email":actor.email,"password":password},timeout=8,follow_redirects=False)
            result=response.json() if response.status_code==200 else {}
        except (httpx.HTTPError,ValueError):
            require(False,"AUTH_UNAVAILABLE","Reauthentication is temporarily unavailable",503)
        require(result.get("user",{}).get("id")==actor.user_id,"REAUTH_REQUIRED","Account password verification failed",401)
        if any(f.get("status")=="verified" for f in actor.factors):
            require(actor.claims.get("aal")=="aal2" and any(a.get("method") in {"totp","phone","webauthn"} and a.get("timestamp",0)>=time.time()-300 for a in actor.claims.get("amr",[])),"MFA_REQUIRED","Complete a fresh second-factor verification before this action",403)
