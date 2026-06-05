import logging
import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from .clients import supabase

log = logging.getLogger(__name__)

bearer_scheme = HTTPBearer()

# Supabase signs JWTs with either:
#   - HS256 (older projects), using a shared secret read from
#     SUPABASE_JWT_SECRET in env, OR
#   - ES256 / RS256 (newer projects), using an asymmetric key pair. The
#     public key is published at <project>/auth/v1/.well-known/jwks.json
#     and we fetch + cache it via PyJWKClient. The first request after
#     a backend restart pays one network call to load the JWKS; every
#     subsequent verify is local signature math.
#
# We try whichever path applies based on the token's `alg` header,
# falling back to the slow supabase.auth.get_user network check only if
# everything else fails (e.g. mid-rotation, malformed config).
_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")
_SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_JWT_AUDIENCE = "authenticated"

# Lazy-init the JWKS client only when we actually see an asymmetric
# token, so projects on HS256 don't pay any network cost at import.
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient | None:
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client
    if not _SUPABASE_URL:
        return None
    url = f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    # cache_keys=True keeps the fetched keys in-process forever, so only
    # the first verify across the backend's lifetime hits the network.
    _jwks_client = PyJWKClient(url, cache_keys=True)
    return _jwks_client


def _verify_local(token: str) -> str | None:
    """Validate the JWT locally. Returns the user id (sub claim) on
    success, None on a recoverable failure so the caller can fall back
    to the network check. Raises HTTPException for unambiguous client
    errors (expired token) — no point round-tripping for those."""
    try:
        # Inspect the header to decide which verification path to take.
        # Modern Supabase issues ES256; older projects issue HS256. We
        # support both so the same code works across deployments.
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
    except jwt.InvalidTokenError:
        return None

    try:
        if alg == "HS256":
            if not _JWT_SECRET:
                return None  # fall back to network
            claims = jwt.decode(
                token, _JWT_SECRET,
                algorithms=["HS256"],
                audience=_JWT_AUDIENCE,
                leeway=30,
            )
        elif alg in ("ES256", "RS256"):
            client = _get_jwks_client()
            if client is None:
                return None
            signing_key = client.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token, signing_key,
                algorithms=[alg],
                audience=_JWT_AUDIENCE,
                leeway=30,
            )
        else:
            # Unknown alg — let the network path handle it.
            return None
        return claims.get("sub")
    except jwt.ExpiredSignatureError:
        # Token is genuinely expired. Don't bother the network — the
        # client just needs to refresh and try again.
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        log.info("local jwt verify failed, falling back: %s: %s",
                 type(e).__name__, e)
        return None


def get_user_id(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> str:
    token = creds.credentials
    # Fast path: local signature check, no network after JWKS warmup.
    user_id = _verify_local(token)
    if user_id:
        return user_id
    # Slow path: ask Supabase Auth. Should only fire in dev (no JWT
    # secret + no SUPABASE_URL) or during a key rotation window.
    try:
        res = supabase.auth.get_user(token)
        return res.user.id
    except Exception as e:
        log.warning("auth check failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=401, detail="Not logged in")
