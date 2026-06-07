from .assess import (
    _resolve_source_chunks,
    document_text_sample,
    extract_json,
    time_from_questions,
)
from .clients import claude, STYLE_RULES, supabase, track_claude
from .permissions import require_document


def weak_areas(user_id, document_id, limit=10):
    aids = [a["id"] for a in supabase.table("assessments").select("id")
            .eq("user_id", user_id).eq("document_id", document_id)
            .execute().data or []]
    if not aids:
        return []
    miss = supabase.table("answers").select("question_id") \
        .eq("user_id", user_id).in_("assessment_id", aids) \
        .eq("is_correct", False).execute().data or []
    qids = [m["question_id"] for m in miss]
    if not qids:
        return []
    qs = supabase.table("questions").select("question_text") \
        .in_("id", qids).execute().data or []
    return [q["question_text"] for q in qs][:limit]


def create_practice(user_id, document_id, level, num=None, time_limit=None):
    require_document(document_id, user_id)
    if num is None:
        num = 5  # practice is small by default
    weak = weak_areas(user_id, document_id)
    source, chunk_ids = document_text_sample(document_id)
    focus = ""
    if weak:
        focus = ("The student got these wrong before, so lean the practice "
                 "toward these areas:\n- " + "\n- ".join(weak) + "\n\n")

    prompt = (
        f"You are making a {level}-level practice test from the material below. "
        f"Write {num} questions, a mix of multiple choice and short theory.\n"
        + focus +
        "Rules: base everything on the material; give the points per question; "
        "for multiple choice give four options (just the answer text, no 'A.' / 'B)' "
        "prefix — the app adds the letter label) and the correct option letter; "
        "for theory give a reference answer and a rubric of key points worth marks. "
        "For every question, include \"source_chunks\": a list of chunk indices "
        "(the numbers in the [chunk N] markers) the question is based on.\n\n"
        "Return ONLY valid JSON in this shape:\n"
        '{"questions":['
        '{"type":"objective","question":"...","options":["...","...","...","..."],'
        '"correct_option":"A","points":1,"source_chunks":[0]},'
        '{"type":"theory","question":"...","reference_answer":"...",'
        '"rubric":[{"point":"...","marks":2}],"points":5,"source_chunks":[1,2]}'
        "]}\n\n"
        f"Material:\n{source}"
        + STYLE_RULES
    )
    raw = track_claude(
        "revise_weak_areas",
        model="claude-sonnet-4-6", max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    ).content[0].text
    questions = extract_json(raw)["questions"]

    if time_limit is None:
        time_limit = time_from_questions(questions)

    a = supabase.table("assessments").insert({
        "user_id": user_id, "document_id": document_id,
        "kind": "test", "format": "mixed", "level": level,
        "time_limit_seconds": time_limit, "status": "ready",
    }).execute()
    aid = a.data[0]["id"]

    rows = [{
        "assessment_id": aid,
        "question_text": q["question"],
        "question_type": q["type"],
        "options": q.get("options"),
        "reference_answer": q.get("correct_option") or q.get("reference_answer"),
        "rubric": q.get("rubric"),
        "points": q.get("points", 1),
        "source_chunk_ids": _resolve_source_chunks(q.get("source_chunks"), chunk_ids),
    } for q in questions]
    supabase.table("questions").insert(rows).execute()
    return aid
