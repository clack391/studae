"""Ping every model configured in app/config.py once, to verify a provider
switch actually works (auth + connectivity + the routing path) before you rely
on it.

Run from study-app-backend/:
    uv run python -m scripts.check_models

It sends a tiny request per UNIQUE model (not per feature) to keep cost
negligible, then reports each feature's model + provider + OK/FAIL. Exit code is
non-zero if any model failed, so it doubles as a CI/pre-deploy smoke check.
"""
import sys

from app import config
from app.clients import provider_of, track_claude, track_gemini_embed

# Features grouped exactly like config.py so the report mirrors the file.
GROUPS = {
    "Ask": ["ASK", "ASK_PHOTO", "ASK_EXTRACT_PHOTO", "ASK_FILTER_SOURCES",
            "ASK_PHOTO_FIGURE_FILTER", "ASK_TAG_TOPIC"],
    "Lesson": ["LESSON", "LESSON_FIGURE_FILTER"],
    "Summary": ["SUMMARY"],
    "Assessment": ["ASSESSMENT_GENERATE", "ASSESSMENT_REGEN_TEXT_ONLY",
                   "ASSESSMENT_FIGURE_VERIFY"],
    "Review": ["GRADING", "REVIEW_FIGURE_FILTER"],
    "Prep": ["REVISION", "FLASHCARDS"],
    "Upload": ["OCR", "OCR_HANDWRITING", "DIAGRAM_DETECT", "OUTLINE"],
    "Embedding": ["EMBED"],
}


def _ping_text(model: str) -> str:
    """Tiny text round-trip. track_claude routes by model, so this exercises
    the real provider path (native or translated)."""
    r = track_claude(
        "model_check", model=model, max_tokens=16,
        messages=[{"role": "user", "content": "Reply with the word OK."}],
    )
    return (r.content[0].text or "").strip().replace("\n", " ")[:40] or "(empty)"


def _ping_embed(model: str) -> str:
    r = track_gemini_embed(
        "model_check", model=model, contents=["ping"],
        config={"output_dimensionality": 1536},
    )
    return f"{len(r.embeddings[0].values)} dims"


def main() -> int:
    # Each unique model is pinged once. Only the EMBED feature uses an embedding
    # ping; everything else uses a text ping (a connectivity check — it does not
    # verify vision capability, so keep a vision-capable model on OCR features).
    kind: dict[str, str] = {}
    for feats in GROUPS.values():
        for f in feats:
            model = getattr(config, f)
            kind[model] = "embed" if f == "EMBED" else kind.get(model, "text")

    results: dict[str, tuple[bool, str]] = {}
    for model, k in kind.items():
        try:
            results[model] = (True, _ping_embed(model) if k == "embed" else _ping_text(model))
        except Exception as e:
            results[model] = (False, f"{type(e).__name__}: {e}"[:120])

    failing = set()
    for group, feats in GROUPS.items():
        print(f"\n{group}:")
        for f in feats:
            model = getattr(config, f)
            ok, detail = results[model]
            try:
                prov = provider_of(model)
            except Exception:
                prov = "?"
            print(f"  [{'OK  ' if ok else 'FAIL'}] {f:26} {model:26} ({prov:9}) {detail}")
            if not ok:
                failing.add(model)

    print(f"\n{len(results)} unique models pinged, {len(failing)} failing.")
    if failing:
        print("Failing models:", ", ".join(sorted(failing)))
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
