import os

import httpx
from dotenv import load_dotenv
from supabase import create_client
import anthropic
from google import genai

# Force every httpx.Client we create (including the ones supabase-py builds
# internally for postgrest / storage / auth) to use HTTP/1.1, not HTTP/2.
#
# Why: FastAPI runs sync endpoints in a threadpool. Our home page fans out
# N parallel GET /focus-areas requests, each hitting Supabase from a
# different worker thread. They all share the one supabase.postgrest httpx
# Client, which shares one HTTP/2 connection. httpcore's HTTP/2 hpack table
# is not thread-safe (RuntimeError: deque mutated during iteration), and we
# see intermittent 500s under that fan-out. HTTP/1.1 sidesteps the race
# because the connection pool serializes per-connection use. Performance
# cost is small (a few extra TCP round-trips on cold pools); correctness
# matters more.
_orig_httpx_client_init = httpx.Client.__init__
def _http1_client_init(self, *args, **kwargs):
    kwargs["http2"] = False
    return _orig_httpx_client_init(self, *args, **kwargs)
httpx.Client.__init__ = _http1_client_init

load_dotenv()

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"],
)
claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=5)
gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


# Append this to every prompt that asks the model to produce user-facing
# natural-language text (lessons, summaries, question text, reference answers,
# grading reasoning, flashcard fronts/backs, outline lines). Keeps AI output
# free of the em-dash tell that the user flagged as a marker of unclean
# AI writing.
STYLE_RULES = (
    "\n\nStyle rules for all natural-language text you produce: "
    "never use em dashes (the '—' character). "
    "Use periods, commas, colons, or parentheses to separate clauses instead. "
    "Write directly. Avoid hedging fillers and throat-clearing. "
    "This rule applies to every sentence you write, including text inside "
    "JSON fields you return."
)
