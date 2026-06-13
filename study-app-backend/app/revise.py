from .assess import (
    _resolve_source_chunks,
    _verify_generated_diagrams,
    document_text_sample,
    extract_json,
    time_from_questions,
)
from . import config
from .clients import STYLE_RULES, supabase, track_claude
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
        "(the numbers in the [chunk N] markers) the question is based on.\n"
        "For a conceptual question where a small diagram helps AND Mermaid can "
        "draw it accurately (flowchart, tree/mindmap, sequenceDiagram, timeline, "
        "or xychart-beta, NOT geometry / circuits / structures / precise graphs), "
        "you may embed ONE Mermaid fenced code block inside that question's "
        "\"question\" text. Use it sparingly and only when it truly helps.\n\n"
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
    # Haiku 4.5 for revise: this is the highest-risk Haiku swap because
    # it generates real questions (objective + theory). These are
    # practice, not graded assessments, so a slightly weaker question
    # only costs the student one round of revision. Watch the next few
    # revise sets and flip back to claude-sonnet-4-6 here if questions
    # feel shallow or repetitive vs the previous Sonnet output.
    raw = track_claude(
        "revise_weak_areas",
        model=config.REVISION, max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    ).content[0].text
    questions = extract_json(raw)["questions"]
    _verify_generated_diagrams(questions)  # drop any unsound AI-drawn diagrams

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
