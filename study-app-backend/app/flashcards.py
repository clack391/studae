"""Flashcards with spaced repetition (SuperMemo 2).

Generation uses Claude on the document's chunks. Reviews are pure Python
arithmetic (no model calls), so they're free against the plan cap.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from .assess import (
    _resolve_source_chunks,
    document_text_sample,
    extract_json,
)
from . import config
from .clients import STYLE_RULES, supabase, track_claude
from .permissions import require_document


GENERATE_PROMPT = (
    "Generate {num} flashcards from the material below at {level} level.\n\n"
    "Each flashcard must:\n"
    "- Have a clear 'front' that prompts a specific concept, fact, term, or "
    "relationship (a recall question, not recognition).\n"
    "- Have a concise 'back' (1–3 sentences max). Avoid lists with more than "
    "three items; split them into separate cards instead.\n"
    "- Include 'source_chunks': the [chunk N] indices that back this card.\n\n"
    "Avoid yes/no questions and questions that contain their own answer. "
    "Spread the cards across the material; don't cluster them all on one "
    "section.\n\n"
    "Return ONLY JSON: "
    '{{"cards":[{{"front":"...","back":"...","source_chunks":[0]}}]}}\n\n'
    "Material:\n{source}"
)


def generate_cards(user_id, document_id, num, level, focus_area_id=None):
    require_document(document_id, user_id)
    if focus_area_id:
        from . import focus as focus_module
        topics = focus_module.resolve_topics(user_id, focus_area_id)
        source, chunk_ids = focus_module.multi_topic_text_sample(
            user_id, document_id, topics)
    else:
        source, chunk_ids = document_text_sample(document_id)
    prompt = GENERATE_PROMPT.format(num=num, level=level, source=source) + STYLE_RULES
    # Haiku 4.5 for flashcards: simpler than test questions (no rubric,
    # no distractors, just front + concise back). Watch a fresh batch
    # for prompts that are too vague or backs that miss the key idea.
    # Flip back to claude-sonnet-4-6 if quality dips.
    raw = track_claude(
        "generate_flashcards",
        model=config.FLASHCARDS,
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    ).content[0].text
    cards = extract_json(raw)["cards"]

    rows = []
    for c in cards:
        rows.append({
            "user_id": user_id,
            "document_id": document_id,
            "front": c["front"],
            "back": c["back"],
            "source_chunk_ids": _resolve_source_chunks(c.get("source_chunks"), chunk_ids),
        })
    inserted = supabase.table("flashcards").insert(rows).execute().data or []
    return _decorate_cards(inserted)


def _decorate_cards(cards):
    """Attach a resolved `sources` array to each card in one bulk lookup."""
    all_ids = set()
    for c in cards:
        for cid in (c.get("source_chunk_ids") or []):
            all_ids.add(cid)
    if not all_ids:
        for c in cards:
            c["sources"] = []
        return cards
    from .chat import clean_snippet
    rows = supabase.table("chunks").select("id, content, page_number, figure_path") \
        .in_("id", list(all_ids)).execute().data or []
    by_id = {r["id"]: r for r in rows}
    for c in cards:
        ids = c.get("source_chunk_ids") or []
        srcs = []
        for cid in ids:
            r = by_id.get(cid)
            if not r:
                continue
            snippet = clean_snippet(r.get("content") or "", 200)
            if not snippet and not r.get("figure_path"):
                continue
            srcs.append({
                "chunk_id": r["id"],
                "page_number": r.get("page_number"),
                "figure_path": r.get("figure_path"),
                "snippet": snippet,
            })
        c["sources"] = srcs
    return cards


def sm2_update(rating: int, ease_factor: float,
               interval_days: int, repetitions: int):
    """SuperMemo 2. Returns (new_ease, new_interval, new_repetitions).

    Rating is the student's self-assessment, 0–5:
      0–2 = forgot / hard recall  → reset progress
      3   = recalled with effort  → advance
      4–5 = recalled well         → advance further
    """
    rating = max(0, min(5, int(rating)))

    if rating < 3:
        new_reps = 0
        new_interval = 1
    else:
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            new_interval = max(1, round(interval_days * ease_factor))
        new_reps = repetitions + 1

    new_ease = ease_factor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02))
    new_ease = max(1.3, round(new_ease, 4))

    return new_ease, new_interval, new_reps


def review_card(user_id, card_id, rating):
    rows = supabase.table("flashcards").select("*") \
        .eq("id", card_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="flashcard not found")
    card = rows[0]

    new_ease, new_interval, new_reps = sm2_update(
        rating,
        float(card.get("ease_factor") or 2.5),
        int(card.get("interval_days") or 0),
        int(card.get("repetitions") or 0),
    )
    now = datetime.now(timezone.utc)
    next_at = (now + timedelta(days=new_interval)).isoformat()

    supabase.table("flashcards").update({
        "ease_factor": new_ease,
        "interval_days": new_interval,
        "repetitions": new_reps,
        "next_review_at": next_at,
        "last_reviewed_at": now.isoformat(),
    }).eq("id", card_id).execute()

    supabase.table("flashcard_reviews").insert({
        "flashcard_id": card_id,
        "user_id": user_id,
        "rating": int(rating),
        "ease_factor_after": new_ease,
        "interval_days_after": new_interval,
    }).execute()

    return {
        "next_review_at": next_at,
        "interval_days": new_interval,
        "ease_factor": new_ease,
        "repetitions": new_reps,
    }


def due_cards(user_id, document_id=None, limit=20):
    q = supabase.table("flashcards").select("*").eq("user_id", user_id)
    if document_id:
        q = q.eq("document_id", document_id)
    q = q.lte("next_review_at", datetime.now(timezone.utc).isoformat())
    q = q.order("next_review_at").limit(limit)
    return _decorate_cards(q.execute().data or [])
