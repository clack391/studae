import logging

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .clients import supabase

log = logging.getLogger(__name__)

bearer_scheme = HTTPBearer()


def get_user_id(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> str:
    token = creds.credentials
    try:
        res = supabase.auth.get_user(token)
        return res.user.id
    except Exception as e:
        log.warning("auth check failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=401, detail="Not logged in")
