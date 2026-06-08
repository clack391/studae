"""Batch embedding (embed_many): one vector per input, order preserved,
empty input short-circuits without an API call. Patches the underlying
track_gemini_embed so the real embed_many body runs."""
import types

from app import ingest


def _fake_embed_response(texts):
    # Gemini batch shape: res.embeddings is a list of objects with .values,
    # one per input text, in order. We encode the input index into the
    # vector's first component so order preservation is observable.
    embs = [types.SimpleNamespace(values=[float(i), 0.0, 0.0])
            for i in range(len(texts))]
    return types.SimpleNamespace(embeddings=embs)


def test_embed_many_one_vector_per_input_order_preserved(monkeypatch):
    captured = {}

    def fake_track(step, ctx=None, **kw):
        captured["step"] = step
        captured["contents"] = kw.get("contents")
        captured["config"] = kw.get("config")
        captured["ctx"] = ctx
        return _fake_embed_response(kw["contents"])

    monkeypatch.setattr(ingest, "track_gemini_embed", fake_track)

    texts = ["alpha", "beta", "gamma", "delta"]
    out = ingest.embed_many(texts, ctx={"doc_id": "d1"})

    assert len(out) == len(texts)               # one vector per input
    assert [v[0] for v in out] == [0.0, 1.0, 2.0, 3.0]  # order preserved
    # the batch call sent the whole list at once, with 1536 dims requested
    assert captured["contents"] == texts
    assert captured["config"] == {"output_dimensionality": 1536}
    assert captured["step"] == "embed_chunk"
    assert captured["ctx"] == {"doc_id": "d1"}


def test_embed_many_empty_input_no_api_call(monkeypatch):
    called = {"n": 0}

    def fake_track(step, ctx=None, **kw):
        called["n"] += 1
        return _fake_embed_response(kw.get("contents", []))

    monkeypatch.setattr(ingest, "track_gemini_embed", fake_track)
    assert ingest.embed_many([]) == []
    assert called["n"] == 0       # short-circuited, no network call


def test_embed_single_returns_first_vector(monkeypatch):
    def fake_track(step, ctx=None, **kw):
        # single embed shape: contents is a str, embeddings[0].values used
        return types.SimpleNamespace(
            embeddings=[types.SimpleNamespace(values=[9.0] * 1536)])

    monkeypatch.setattr(ingest, "track_gemini_embed", fake_track)
    vec = ingest.embed("hello", ctx={"doc_id": "d2"})
    assert len(vec) == 1536
    assert vec[0] == 9.0
