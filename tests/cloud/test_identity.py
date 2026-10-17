import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from services.cloud.auth import SupabaseIdentity
from services.cloud.config import Config
from services.api.domain import Problem


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.config=Config("not-used","https://synthetic.supabase.co","synthetic-key","https://synthetic.example")
        self.identity=SupabaseIdentity(self.config)
        self.key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        self.user=str(uuid4())
        self.claims={"sub":self.user,"session_id":str(uuid4()),"iss":self.config.supabase_url+"/auth/v1","aud":"authenticated","iat":int(time.time()),"exp":int(time.time())+300}
        self.identity.jwks=SimpleNamespace(get_signing_key_from_jwt=lambda _:SimpleNamespace(key=self.key.public_key()))
    def test_signed_identity_is_verified_against_the_fixed_provider(self):
        token=jwt.encode(self.claims,self.key,algorithm="RS256")
        response=SimpleNamespace(status_code=200,json=lambda:{"id":self.user,"email":"synthetic@example.test","email_confirmed_at":"2026-01-01","is_anonymous":False})
        with patch("services.cloud.auth.httpx.get",return_value=response) as call:
            actor=self.identity.verify(token)
            self.assertEqual(actor.user_id,self.user)
            self.assertEqual(call.call_args.args[0],self.config.supabase_url+"/auth/v1/user")
            self.assertFalse(call.call_args.kwargs["follow_redirects"])
    def test_wrong_audience_issuer_signature_expiry_and_missing_session_never_reach_provider(self):
        variations=[{**self.claims,"aud":"someone-else"},{**self.claims,"iss":"https://evil.example"},{**self.claims,"exp":int(time.time())-60},{k:v for k,v in self.claims.items() if k!="session_id"}]
        with patch("services.cloud.auth.httpx.get") as call:
            for claims in variations:
                with self.assertRaises(Problem):self.identity.verify(jwt.encode(claims,self.key,algorithm="RS256"))
            other=rsa.generate_private_key(public_exponent=65537,key_size=2048)
            with self.assertRaises(Problem):self.identity.verify(jwt.encode(self.claims,other,algorithm="RS256"))
            with self.assertRaises(Problem):self.identity.verify(jwt.encode(self.claims,key=None,algorithm="none"))
            call.assert_not_called()
