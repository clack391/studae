"""Shared pytest fixtures for the Studae backend unit suite.

CRITICAL (integration contract item 7): app.clients reads os.environ at
*import* time (SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY,
GEMINI_API_KEY) and constructs the supabase / anthropic / gemini client
objects right there. So dummy env vars MUST be set BEFORE any `app.*`
import happens anywhere in the suite. We do it at module top, before the
first app import below, so importing this conftest is enough to make the
whole package importable without real credentials or network.

No test in this suite touches the network. Every network-touching call
(track_claude / track_gemini / track_gemini_embed, embed / embed_many,
supabase.table(...) chains, supabase.storage) is monkeypatched by the
fixtures here or inside individual tests.
"""
import os
import uuid

# --- env MUST be set before importing anything under app.* -----------------
for _k, _v in {
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_KEY": "dummy-service-key",
    "SUPABASE_ANON_KEY": "dummy-anon-key",
    "ANTHROPIC_API_KEY": "dummy-anthropic-key",
    "GEMINI_API_KEY": "dummy-gemini-key",
}.items():
    os.environ.setdefault(_k, _v)

import pytest  # noqa: E402

# Importing app.clients is what actually constructs the real client objects
# from the dummy env above. It does not make any network calls at import.
from app import clients  # noqa: E402
from app import ingest  # noqa: E402


# =========================================================================
# Fake in-memory supabase double.
# =========================================================================
# Records every insert / delete / update / upload so resumable-ingest and
# idempotency behaviour can be asserted. Mimics just the slice of the
# supabase-py fluent API that ingest.py uses:
#
#   supabase.table("chunks").delete().eq(...).eq(...).execute()
#   supabase.table("chunks").insert(rows).execute()
#   supabase.table("documents").update({...}).eq("id", x).execute()
#   supabase.table("documents").select("ingest_cursor").eq("id", x).execute()
#   supabase.storage.from_("uploads").upload(path, png, {...})
#
# Each builder method returns self so calls chain; .execute() returns a
# small object carrying `.data`.


class _Result:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    """One fluent builder bound to a table + operation. Filters accumulate
    in `filters`; the terminal `.execute()` applies the op against the
    parent FakeTable's row list and logs it."""

    def __init__(self, table, op, payload=None):
        self.table = table
        self.op = op
        self.payload = payload
        self.filters = {}
        self.select_cols = None

    # --- builder methods (all return self so they chain) ---
    def eq(self, col, val):
        self.filters[col] = val
        return self

    def neq(self, col, val):
        self.filters[("neq", col)] = val
        return self

    def in_(self, col, vals):
        self.filters[("in", col)] = list(vals)
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def select(self, cols="*"):
        self.select_cols = cols
        self.op = "select"
        return self

    # --- terminal ---
    def _matches(self, row):
        for k, v in self.filters.items():
            if isinstance(k, tuple) and k[0] == "in":
                if row.get(k[1]) not in v:
                    return False
            elif isinstance(k, tuple) and k[0] == "neq":
                if row.get(k[1]) == v:
                    return False
            else:
                if row.get(k) != v:
                    return False
        return True

    def execute(self):
        t = self.table
        if self.op == "select":
            rows = [dict(r) for r in t.rows if self._matches(r)]
            t.log.append(("select", t.name, dict(self.filters), self.select_cols))
            return _Result(rows)
        if self.op == "insert":
            payload = self.payload
            items = payload if isinstance(payload, list) else [payload]
            stored = []
            for it in items:
                row = dict(it)
                # Real Supabase (Postgres) auto-generates a primary key on
                # insert. Callers like /upload and /session read
                # `result.data[0]["id"]` immediately, so synthesize one when
                # the payload doesn't carry it. Explicit ids (seeded rows in
                # tests) are preserved untouched.
                if "id" not in row or row["id"] is None:
                    row["id"] = str(uuid.uuid4())
                t.rows.append(row)
                stored.append(dict(row))
            t.log.append(("insert", t.name, [dict(i) for i in stored]))
            return _Result([dict(i) for i in stored])
        if self.op == "delete":
            kept = [r for r in t.rows if not self._matches(r)]
            removed = [r for r in t.rows if self._matches(r)]
            t.rows[:] = kept
            t.log.append(("delete", t.name, dict(self.filters), len(removed)))
            return _Result(removed)
        if self.op == "update":
            n = 0
            for r in t.rows:
                if self._matches(r):
                    r.update(self.payload)
                    n += 1
            t.log.append(("update", t.name, dict(self.payload), dict(self.filters)))
            return _Result([])
        raise AssertionError(f"unhandled op {self.op}")


class FakeTable:
    def __init__(self, name, store):
        self.name = name
        self.store = store
        # shared per-table row + op log lists, so the same table object can
        # be looked up repeatedly via supabase.table(name)
        self.rows = store.rows.setdefault(name, [])
        self.log = store.log

    def insert(self, payload):
        return FakeQuery(self, "insert", payload)

    def delete(self):
        return FakeQuery(self, "delete")

    def update(self, payload):
        return FakeQuery(self, "update", payload)

    def select(self, cols="*"):
        q = FakeQuery(self, "select")
        q.select_cols = cols
        return q


class FakeStorageBucket:
    def __init__(self, store):
        self.store = store

    def upload(self, path, data, options=None):
        self.store.uploads.append((path, data, options))
        # Also index by path so list()/download() can resolve it. This is
        # additive — the (path, data, options) tuple list above is what the
        # ingest tests assert on and is left untouched.
        self.store.objects[path] = data
        return {"path": path}

    def remove(self, paths):
        self.store.removed.extend(paths)
        for p in paths:
            self.store.objects.pop(p, None)
        return paths

    def list(self, prefix=""):
        """Mimic supabase storage list(prefix): returns one entry per object
        that lives directly under `prefix`, each a dict with `name` (the path
        segment after the prefix) and a non-null `id`. main.py calls this with
        the prefix sans trailing slash, so we normalise to a trailing slash
        before matching."""
        norm = prefix if prefix.endswith("/") or prefix == "" else prefix + "/"
        out = []
        for full in self.store.objects:
            if norm and not full.startswith(norm):
                continue
            rest = full[len(norm):]
            if not rest or "/" in rest:
                continue  # only direct children, not nested deeper
            out.append({"name": rest, "id": rest})
        return out

    def download(self, path):
        if path not in self.store.objects:
            raise FileNotFoundError(path)
        return self.store.objects[path]

    def create_signed_url(self, path, expires_in):
        return {"signedURL": f"https://signed.example/{path}?exp={expires_in}"}


class FakeStorage:
    def __init__(self, store):
        self.store = store

    def from_(self, bucket):
        return FakeStorageBucket(self.store)


class FakeSupabase:
    """Top-level double exposing .table(...) and .storage."""

    def __init__(self):
        self.rows = {}          # table name -> list[dict]
        self.log = []           # ordered op log across all tables
        self.uploads = []       # (path, bytes, options)
        self.removed = []       # storage removals
        self.objects = {}       # path -> bytes, backs list()/download()
        self.storage = FakeStorage(self)

    def table(self, name):
        return FakeTable(name, self)

    # --- convenience accessors used by tests ---
    def ops(self, op=None, table=None):
        out = self.log
        if op is not None:
            out = [e for e in out if e[0] == op]
        if table is not None:
            out = [e for e in out if e[1] == table]
        return out

    def chunks(self):
        return self.rows.get("chunks", [])

    def documents(self):
        return self.rows.get("documents", [])


@pytest.fixture
def fake_supabase(monkeypatch):
    """Patch ingest.supabase (the name ingest.py actually calls) with the
    in-memory double. Seeds an empty documents table; tests can add a
    documents row to drive the resume path."""
    fake = FakeSupabase()
    monkeypatch.setattr(ingest, "supabase", fake)
    return fake


# =========================================================================
# LLM / embedding monkeypatches.
# =========================================================================

@pytest.fixture
def fake_embed(monkeypatch):
    """Replace ingest.embed / ingest.embed_many with deterministic, no-network
    stubs. embed_many returns one distinct vector per input, order preserved
    (so the order-preservation assertion is meaningful). Returns a dict of
    call records so tests can inspect what was embedded."""
    calls = {"embed": [], "embed_many": []}

    def _embed(text, ctx=None):
        calls["embed"].append((text, ctx))
        return [0.0] * 1536

    def _embed_many(texts, ctx=None):
        calls["embed_many"].append((list(texts), ctx))
        # one distinct vector per input; first component encodes the index so
        # order is observable in assertions.
        return [[float(i)] + [0.0] * 1535 for i in range(len(texts))]

    monkeypatch.setattr(ingest, "embed", _embed)
    monkeypatch.setattr(ingest, "embed_many", _embed_many)
    return calls


@pytest.fixture
def no_track(monkeypatch):
    """Neuter the three track_* wrappers so nothing hits a real API. Returns
    a record of (step, kwargs) per wrapper. Default return objects are bare
    SimpleNamespaces; individual tests override return values as needed."""
    import types as _t
    records = {"claude": [], "gemini": [], "embed": []}

    def _claude(step, ctx=None, **kw):
        records["claude"].append((step, ctx, kw))
        return _t.SimpleNamespace(content=[_t.SimpleNamespace(text="outline")])

    def _gemini(step, ctx=None, **kw):
        records["gemini"].append((step, ctx, kw))
        return _t.SimpleNamespace(text="")

    def _embed(step, ctx=None, **kw):
        records["embed"].append((step, ctx, kw))
        return _t.SimpleNamespace(embeddings=[_t.SimpleNamespace(values=[0.0] * 1536)])

    monkeypatch.setattr(ingest, "track_claude", _claude)
    monkeypatch.setattr(ingest, "track_gemini", _gemini)
    monkeypatch.setattr(ingest, "track_gemini_embed", _embed)
    return records


@pytest.fixture
def clients_mod():
    """Direct handle to app.clients for the usage-tagging tests."""
    return clients


@pytest.fixture
def ingest_mod():
    return ingest
