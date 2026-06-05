"""End-to-end smoke test that hits every backend endpoint.

Usage:
    uv run python -m tests.smoke_test <email> <password> [document_id]

If document_id is omitted, the script uses the first ready document on
the dashboard. The PDF is NOT re-uploaded — make sure ingestion has
already finished for at least one document on the test account.

Coverage: 33 of 40 endpoints. Skipped:
  - /healthz auth gating (the endpoint is public, covered as the first check)
  - /upload          — needs a fresh PDF and minutes of ingestion wait
  - /ask-photo       — needs a real problem image
  - /answer/save-photo — same
  - DELETE /me/account — destructive; tested by hand against a throwaway user

What it checks:
  public      /healthz /plans
  reads       /dashboard /me/access /history /documents/{id}/progress
  estimate    /assessment/estimate
  chat        /session /ask /lesson/start /lesson/next
  summarize   /documents/{id}/summarize
  focus areas /focus-areas (POST/GET) /focus-areas/{id} (GET/PATCH/DELETE)
  assess      /assessment/create /assessment/start /assessment/{id}/time
              /answer/save (×2) /assessment/submit /history/{id}
              /answer/{id}/dispute
  revision    /revision/{doc}/misses /revision/practice
  flashcards  /flashcards/generate /documents/{id}/flashcards
              /flashcards/due /flashcards/{id}/review /flashcards/{id} (DELETE)
  settings    /settings round-trip via /dashboard

Costs and caveats:
  - Each run makes ~6 Claude calls (~$0.20–0.30) and several Gemini embedding calls.
  - Counts ~3 assessments + ~2 questions against the plan cap.
    A basic-trial user will be blocked after one run. Use pro for the test account.
  - Settings are restored to their starting values at the end.
  - The focus area created during the run is deleted at the end (cleanup).
"""
import os
import sys

from dotenv import load_dotenv
from supabase import create_client

import httpx


BASE = "http://localhost:8000"


def fail(name, reason):
    print(f"  ✗ {name}: {reason}")
    sys.exit(1)


def check(name, response, *, must_have=(), forbid=()):
    if response.status_code >= 400:
        fail(name, f"HTTP {response.status_code}: {response.text[:200]}")
    try:
        data = response.json()
    except Exception:
        data = None
    for key in must_have:
        if data is None or key not in data:
            fail(name, f"missing '{key}' in response")
    for key in forbid:
        if data is not None and key in data:
            fail(name, f"forbidden key '{key}' leaked in response")
    print(f"  ✓ {name}")
    return data


def main():
    load_dotenv()

    if len(sys.argv) < 3:
        print("usage: python -m tests.smoke_test <email> <password> [document_id]",
              file=sys.stderr)
        sys.exit(1)

    email, password = sys.argv[1], sys.argv[2]
    doc_id = sys.argv[3] if len(sys.argv) > 3 else None

    # --- Public (no auth) ----------------------------------------------------
    print("Public")
    with httpx.Client(base_url=BASE, timeout=30) as anon:
        check("/healthz", anon.get("/healthz"), must_have=("ok",))
        check("/plans", anon.get("/plans"), must_have=("plans",))

    # --- Auth ----------------------------------------------------------------
    print("\nAuth")
    auth_client = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_ANON_KEY"],
    )
    res = auth_client.auth.sign_in_with_password({"email": email, "password": password})
    token = res.session.access_token
    print(f"  ✓ signed in as {email}")

    headers = {"Authorization": f"Bearer {token}"}

    with httpx.Client(base_url=BASE, headers=headers, timeout=180) as c:

        # --- Reads -----------------------------------------------------------
        print("\nReads")
        dashboard = check("/dashboard", c.get("/dashboard"),
                          must_have=("documents", "documents_count",
                                     "tts_enabled", "recent_assessments"))
        check("/me/access", c.get("/me/access"),
              must_have=("state", "usage", "limits"))
        check("/history", c.get("/history"), must_have=("assessments",))

        # Resolve a document to use
        if not doc_id:
            ready = [d for d in dashboard["documents"] if d["status"] == "ready"]
            if not ready:
                fail("setup", "no ready documents on this account — upload one first")
            doc_id = ready[0]["id"]
        print(f"    using document {doc_id}")

        check(f"/documents/{{id}}/progress",
              c.get(f"/documents/{doc_id}/progress"),
              must_have=("topics_total", "topics_taught",
                         "flashcards_in_library", "flashcards_mastered"))

        # Remember initial settings so we can restore them
        initial_tts = dashboard["tts_enabled"]
        initial_level = dashboard["preferred_level"]

        # --- Estimate --------------------------------------------------------
        print("\nEstimate")
        check("/assessment/estimate",
              c.get("/assessment/estimate?kind=test&format=mixed&num_questions=4"),
              must_have=("estimated_time_seconds", "rule"))

        # --- Chat ------------------------------------------------------------
        print("\nChat")
        session = check("/session", c.post("/session", json={
            "document_id": doc_id, "level": "novice",
        }), must_have=("session_id",))
        session_id = session["session_id"]

        ask = check("/ask", c.post("/ask", json={
            "session_id": session_id, "document_id": doc_id,
            "question": "Summarize this material in one short sentence.",
            "level": "novice",
        }), must_have=("answer", "sources"))
        if not ask["answer"].strip():
            fail("/ask", "empty answer")

        lesson = check("/lesson/start", c.post("/lesson/start", json={
            "document_id": doc_id, "level": "novice",
        }), must_have=("session_id",))
        lesson_id = lesson["session_id"]

        next_lesson = check("/lesson/next", c.post("/lesson/next", json={
            "session_id": lesson_id,
        }), must_have=("lesson",))
        if next_lesson.get("done"):
            print("    note: outline already finished on this account")

        # --- Session history ---------------------------------------------
        sessions_resp = check(f"/sessions?document_id={{doc}}",
                              c.get(f"/sessions?document_id={doc_id}"),
                              must_have=("sessions",))
        if not any(s["id"] == lesson_id for s in sessions_resp["sessions"]):
            fail("/sessions", "newly-created lesson session missing from list")

        msgs = check("/sessions/{id}/messages",
                     c.get(f"/sessions/{lesson_id}/messages"),
                     must_have=("messages",))
        if not msgs["messages"]:
            fail("/sessions/{id}/messages",
                 "lesson session should have at least one assistant message")

        # --- Summarize -------------------------------------------------------
        print("\nSummarize")
        check("/documents/{id}/summarize (outline)",
              c.post(f"/documents/{doc_id}/summarize", json={"level": "novice"}),
              must_have=("summary",))

        # --- Focus areas -----------------------------------------------------
        print("\nFocus areas")
        focus = check("/focus-areas (POST)", c.post("/focus-areas", json={
            "document_id": doc_id, "name": "Smoke test focus",
            "topics": ["main concepts", "key terms"],
            "exam_date": "2027-01-01",
        }), must_have=("id", "name", "topics"))
        focus_id = focus["id"]

        check("/focus-areas (LIST)",
              c.get(f"/focus-areas?document_id={doc_id}"),
              must_have=("focus_areas",))
        check("/focus-areas/{id} (GET)",
              c.get(f"/focus-areas/{focus_id}"), must_have=("id", "topics"))
        check("/focus-areas/{id} (PATCH)",
              c.patch(f"/focus-areas/{focus_id}",
                      json={"name": "Smoke test focus (renamed)"}),
              must_have=("name",))

        # --- Assessment ------------------------------------------------------
        print("\nAssessment")
        created = check("/assessment/create", c.post("/assessment/create", json={
            "document_id": doc_id, "format": "mixed", "level": "novice",
            "num_questions": 2,
        }), must_have=("assessment_id",))
        aid = created["assessment_id"]

        started = check("/assessment/start", c.post("/assessment/start", json={
            "assessment_id": aid,
        }), must_have=("questions", "seconds_left"))
        for q in started["questions"]:
            for leaked in ("reference_answer", "rubric", "correct_option"):
                if leaked in q:
                    fail("/assessment/start", f"'{leaked}' leaked")
        print(f"    safe_question OK ({len(started['questions'])} questions)")

        check("/assessment/{id}/time",
              c.get(f"/assessment/{aid}/time"), must_have=("seconds_left",))

        for q in started["questions"]:
            ans = "A" if q["question_type"] == "objective" else "My best attempt."
            check(f"/answer/save ({q['question_type']})",
                  c.post("/answer/save", json={
                      "assessment_id": aid, "question_id": q["id"],
                      "student_answer": ans,
                  }), must_have=("saved",))

        submitted = check("/assessment/submit", c.post("/assessment/submit", json={
            "assessment_id": aid,
        }), must_have=("score", "total", "results"))
        print(f"    graded: {submitted['score']}/{submitted['total']}")
        first_answer_id = submitted["results"][0]["answer_id"]

        # --- Dispute ---------------------------------------------------------
        print("\nDispute")
        check("/answer/{id}/dispute", c.post(
            f"/answer/{first_answer_id}/dispute",
            json={"reason": "smoke test placeholder dispute"}),
            must_have=("disputed",))

        # --- History + revision ---------------------------------------------
        print("\nHistory and revision")
        hist_detail = check("/history/{id}", c.get(f"/history/{aid}"),
                            must_have=("assessment", "results"))
        if not any(r.get("disputed") for r in hist_detail["results"]):
            fail("/history/{id}", "disputed status didn't propagate")
        check("/revision/{doc}/misses",
              c.get(f"/revision/{doc_id}/misses"), must_have=("misses",))
        check("/revision/practice", c.post("/revision/practice", json={
            "document_id": doc_id, "level": "novice", "num_questions": 2,
        }), must_have=("assessment_id",))

        # --- Flashcards ------------------------------------------------------
        print("\nFlashcards")
        cards_resp = check("/flashcards/generate", c.post("/flashcards/generate", json={
            "document_id": doc_id, "num": 3, "level": "novice",
        }), must_have=("cards",))
        if not cards_resp["cards"]:
            fail("/flashcards/generate", "no cards returned")
        card_id = cards_resp["cards"][0]["id"]

        check("/documents/{id}/flashcards",
              c.get(f"/documents/{doc_id}/flashcards"), must_have=("cards",))
        check("/flashcards/due",
              c.get(f"/flashcards/due?document_id={doc_id}"),
              must_have=("cards",))
        review = check("/flashcards/{id}/review",
                       c.post(f"/flashcards/{card_id}/review", json={"rating": 5}),
                       must_have=("next_review_at", "interval_days",
                                  "ease_factor", "repetitions"))
        if review["repetitions"] != 1:
            fail("/flashcards/{id}/review",
                 f"expected repetitions=1 after rating 5, got {review['repetitions']}")
        check("/flashcards/{id} (DELETE)",
              c.delete(f"/flashcards/{card_id}"), must_have=("deleted",))

        # --- Settings round-trip --------------------------------------------
        print("\nSettings round-trip")
        flipped = not initial_tts
        check("/settings (flip)", c.post("/settings", json={
            "tts_enabled": flipped, "preferred_level": "amateur",
        }), must_have=("updated",))
        after = check("/dashboard (verify)", c.get("/dashboard"))
        if after["tts_enabled"] != flipped or after["preferred_level"] != "amateur":
            fail("/settings", "change did not persist on /dashboard")
        check("/settings (restore)", c.post("/settings", json={
            "tts_enabled": initial_tts, "preferred_level": initial_level,
        }), must_have=("updated",))

        # --- Cleanup --------------------------------------------------------
        print("\nCleanup")
        check("/focus-areas/{id} (DELETE)",
              c.delete(f"/focus-areas/{focus_id}"), must_have=("deleted",))

    print("\nAll endpoints OK.")


if __name__ == "__main__":
    main()
