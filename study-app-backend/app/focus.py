"""Focus areas (a.k.a. Area of Concentration) — saved lists of topics from a
document that a student wants to concentrate on for an upcoming exam.

A focus area is one row in `focus_areas` with a `topics` JSON array. It can
be referenced by `/assessment/create`, `/flashcards/generate`, and
`/lesson/start` to scope question/card/lesson generation to those topics
only — multi-topic RAG instead of the whole document.
"""
from datetime import date

from fastapi import HTTPException

from .clients import supabase
from .permissions import require_document, require_focus_area


def create(user_id, document_id, name, topics, exam_date=None):
    require_document(document_id, user_id)
    if not topics:
        raise HTTPException(status_code=422, detail="topics must be a non-empty list")
    row = {
        "user_id": user_id,
        "document_id": document_id,
        "name": name,
        "topics": topics,
        "exam_date": exam_date.isoformat() if isinstance(exam_date, date) else exam_date,
    }
    return supabase.table("focus_areas").insert(row).execute().data[0]


def list_for_document(user_id, document_id):
    require_document(document_id, user_id)
    return supabase.table("focus_areas").select("*") \
        .eq("user_id", user_id).eq("document_id", document_id) \
        .order("created_at", desc=True).execute().data or []


def get(user_id, focus_area_id):
    require_focus_area(focus_area_id, user_id)
    return supabase.table("focus_areas").select("*") \
        .eq("id", focus_area_id).execute().data[0]


def update(user_id, focus_area_id, name=None, topics=None, exam_date=None):
    require_focus_area(focus_area_id, user_id)
    patch = {}
    if name is not None:
        patch["name"] = name
    if topics is not None:
        if not topics:
            raise HTTPException(status_code=422, detail="topics must be a non-empty list")
        patch["topics"] = topics
    if exam_date is not None:
        patch["exam_date"] = (
            exam_date.isoformat() if isinstance(exam_date, date) else exam_date
        )
    if not patch:
        return get(user_id, focus_area_id)
    return supabase.table("focus_areas").update(patch) \
        .eq("id", focus_area_id).execute().data[0]


def delete(user_id, focus_area_id):
    require_focus_area(focus_area_id, user_id)
    supabase.table("focus_areas").delete().eq("id", focus_area_id).execute()


def multi_topic_text_sample(user_id, document_id, topics, k_per_topic=4, max_chars=40000):
    """RAG retrieval across multiple topics. Returns (labelled_text, chunk_ids)
    in the same shape as `assess.document_text_sample`.

    For each topic, pulls the top k chunks via vector search. De-duplicates
    chunks that match more than one topic. Caps the total at `max_chars`.
    """
    from .chat import search_chunks

    seen = set()
    aggregated = []
    for topic in topics:
        for c in search_chunks(user_id, document_id, topic, k=k_per_topic):
            if c["id"] not in seen:
                seen.add(c["id"])
                aggregated.append(c)

    pieces, chunk_ids, used = [], [], 0
    for i, c in enumerate(aggregated):
        piece = f"[chunk {i}]\n{c['content']}"
        if used + len(piece) > max_chars:
            break
        pieces.append(piece)
        chunk_ids.append(c["id"])
        used += len(piece) + 2
    return "\n\n".join(pieces), chunk_ids


def resolve_topics(user_id, focus_area_id):
    """Convenience: load a focus area and return its topics list (after
    ownership check). Used by /assessment/create, /flashcards/generate,
    and /lesson/start."""
    fa = get(user_id, focus_area_id)
    return fa["topics"] or []
