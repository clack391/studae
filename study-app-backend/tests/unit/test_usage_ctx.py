"""Usage-context tagging (integration contract item 1):
track_* gain an optional ctx kwarg; _record_usage writes doc_id /
session_id as top-level jsonl fields when present, omits them when absent,
and keeps the existing fields (ts, step, model, input, output, cost_usd)
intact. Existing call sites that pass no ctx stay unchanged."""
import json
import types

from app import clients


# --------------------------------------------------------------------------
# _record_usage — the writer. We point _USAGE_FILE at a temp path so the
# real JSONL writer runs and we can read back the line.
# --------------------------------------------------------------------------

def _read_lines(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def test_record_usage_writes_doc_id(tmp_path, monkeypatch):
    f = tmp_path / "usage.jsonl"
    monkeypatch.setattr(clients, "_USAGE_FILE", f)
    clients._record_usage("ocr_page", "gemini-2.5-flash-lite", 100, 0,
                          ctx={"doc_id": "d1"})
    rows = _read_lines(f)
    assert len(rows) == 1
    row = rows[0]
    assert row["doc_id"] == "d1"
    assert "session_id" not in row          # absent key omitted entirely
    # existing fields intact and unchanged in shape
    for k in ("ts", "step", "model", "input", "output", "cost_usd"):
        assert k in row
    assert row["step"] == "ocr_page"
    assert row["model"] == "gemini-2.5-flash-lite"
    assert row["input"] == 100
    assert row["output"] == 0


def test_record_usage_writes_both_tags(tmp_path, monkeypatch):
    f = tmp_path / "usage.jsonl"
    monkeypatch.setattr(clients, "_USAGE_FILE", f)
    clients._record_usage("ask", "claude-haiku-4-5", 50, 20,
                          ctx={"doc_id": "d2", "session_id": "s9"})
    row = _read_lines(f)[0]
    assert row["doc_id"] == "d2"
    assert row["session_id"] == "s9"


def test_record_usage_no_ctx_omits_tags(tmp_path, monkeypatch):
    f = tmp_path / "usage.jsonl"
    monkeypatch.setattr(clients, "_USAGE_FILE", f)
    clients._record_usage("build_outline", "claude-haiku-4-5", 10, 5)
    row = _read_lines(f)[0]
    assert "doc_id" not in row and "session_id" not in row


def test_record_usage_null_values_omitted(tmp_path, monkeypatch):
    f = tmp_path / "usage.jsonl"
    monkeypatch.setattr(clients, "_USAGE_FILE", f)
    clients._record_usage("step", "claude-haiku-4-5", 1, 1,
                          ctx={"doc_id": None, "session_id": None})
    row = _read_lines(f)[0]
    assert "doc_id" not in row and "session_id" not in row


def test_record_usage_cost_computed(tmp_path, monkeypatch):
    f = tmp_path / "usage.jsonl"
    monkeypatch.setattr(clients, "_USAGE_FILE", f)
    # haiku 4.5: $1.00/1M in, $5.00/1M out
    clients._record_usage("x", "claude-haiku-4-5", 1_000_000, 1_000_000)
    row = _read_lines(f)[0]
    assert row["cost_usd"] == 6.0


# --------------------------------------------------------------------------
# track_* wrappers pass ctx through to _record_usage.
# --------------------------------------------------------------------------

def test_track_claude_forwards_ctx(monkeypatch):
    recorded = {}

    def fake_record(step, model, in_t, out_t, ctx=None):
        recorded.update(step=step, model=model, in_t=in_t, out_t=out_t, ctx=ctx)

    monkeypatch.setattr(clients, "_record_usage", fake_record)
    fake_resp = types.SimpleNamespace(
        usage=types.SimpleNamespace(input_tokens=12, output_tokens=7))
    monkeypatch.setattr(
        clients.claude.messages, "create", lambda **kw: fake_resp)

    resp = clients.track_claude("build_outline", model="claude-haiku-4-5",
                                ctx={"doc_id": "dX"}, messages=[])
    assert resp is fake_resp
    assert recorded["ctx"] == {"doc_id": "dX"}
    assert recorded["in_t"] == 12 and recorded["out_t"] == 7
    assert recorded["model"] == "claude-haiku-4-5"


def test_track_claude_default_ctx_is_none(monkeypatch):
    recorded = {}

    def fake_record(step, model, in_t, out_t, ctx=None):
        recorded["ctx"] = ctx

    monkeypatch.setattr(clients, "_record_usage", fake_record)
    fake_resp = types.SimpleNamespace(
        usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(clients.claude.messages, "create", lambda **kw: fake_resp)

    clients.track_claude("ask", model="claude-haiku-4-5", messages=[])
    assert recorded["ctx"] is None   # unchanged call sites get ctx=None


def test_track_gemini_forwards_ctx(monkeypatch):
    recorded = {}

    def fake_record(step, model, in_t, out_t, ctx=None):
        recorded.update(in_t=in_t, out_t=out_t, ctx=ctx)

    monkeypatch.setattr(clients, "_record_usage", fake_record)
    fake_resp = types.SimpleNamespace(
        text="hi",
        usage_metadata=types.SimpleNamespace(
            prompt_token_count=30, candidates_token_count=9))
    monkeypatch.setattr(
        clients.gemini.models, "generate_content", lambda **kw: fake_resp)

    clients.track_gemini("ocr_page", model="gemini-2.5-flash-lite",
                         ctx={"doc_id": "dG"}, contents=[])
    assert recorded["ctx"] == {"doc_id": "dG"}
    assert recorded["in_t"] == 30 and recorded["out_t"] == 9


def test_track_gemini_embed_forwards_ctx(monkeypatch):
    recorded = {}

    def fake_record(step, model, in_t, out_t, ctx=None):
        recorded.update(in_t=in_t, out_t=out_t, ctx=ctx)

    monkeypatch.setattr(clients, "_record_usage", fake_record)
    fake_resp = types.SimpleNamespace(
        embeddings=[types.SimpleNamespace(values=[0.0])],
        usage_metadata=types.SimpleNamespace(prompt_token_count=40))
    monkeypatch.setattr(
        clients.gemini.models, "embed_content", lambda **kw: fake_resp)

    clients.track_gemini_embed("embed_chunk", model="gemini-embedding-001",
                               ctx={"session_id": "sE"}, contents="x")
    assert recorded["ctx"] == {"session_id": "sE"}
    # embeddings have no output tokens
    assert recorded["in_t"] == 40 and recorded["out_t"] == 0
