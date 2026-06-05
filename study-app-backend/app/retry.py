"""Retry helpers for transient Claude and Gemini failures.

The Anthropic SDK has its own retry config (set via `max_retries` on the
client in clients.py). The Gemini SDK does not retry by default, so wrap
its calls with @transient.
"""
import functools
import time

import httpx

_TRANSIENT_TYPES = [
    httpx.TransportError,
    httpx.TimeoutException,
    ConnectionError,
    TimeoutError,
]
try:
    from google.genai.errors import ServerError
    _TRANSIENT_TYPES.append(ServerError)
except ImportError:
    pass

TRANSIENT = tuple(_TRANSIENT_TYPES)


def _is_rate_limit(exc: Exception) -> bool:
    """Gemini returns 429 as ClientError with code 429."""
    try:
        from google.genai.errors import ClientError
    except ImportError:
        return False
    return isinstance(exc, ClientError) and getattr(exc, "code", None) == 429


class QuotaExhausted(Exception):
    """Raised after retry exhausts a 429 RESOURCE_EXHAUSTED. The caller can
    distinguish this from a generic failure and write a clear UI message."""


def transient(attempts: int = 4, base_delay: float = 1.0,
              rate_limit_attempts: int = 5, rate_limit_base: float = 8.0):
    """Retry on transient network/server errors with exponential backoff.

    Separately retries Gemini 429s with longer waits (8 / 16 / 32 / 64 / 128 s
    by default). Per-minute Gemini windows are 60 s, so this covers bursts.
    A 429 budget that exhausts raises QuotaExhausted; that signals to the
    caller "this isn't a network blip, it's the daily cap."
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            transient_tries = 0
            rl_tries = 0
            while True:
                try:
                    return fn(*args, **kwargs)
                except TRANSIENT:
                    if transient_tries >= attempts - 1:
                        raise
                    time.sleep(base_delay * (2 ** transient_tries))
                    transient_tries += 1
                except Exception as e:
                    if not _is_rate_limit(e):
                        raise
                    if rl_tries >= rate_limit_attempts - 1:
                        raise QuotaExhausted(str(e)) from e
                    time.sleep(rate_limit_base * (2 ** rl_tries))
                    rl_tries += 1
        return wrapper
    return decorator
