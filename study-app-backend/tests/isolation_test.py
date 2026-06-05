"""Cross-user isolation test.

Verifies that one user (B) cannot read or write another user's (A's) data
even if they hold a valid Supabase JWT and know A's UUIDs.

Usage:
    uv run python -m tests.isolation_test <user_a_email> <user_a_password>

What it does:
    1. Signs in as user A (the email/password you pass).
    2. Reads A's dashboard + history to learn A's document_id, session_id,
       assessment_id values it can later try to access as B.
    3. Creates a fresh temporary user B via the Supabase admin API
       (email auto-confirmed). Signs in as B.
    4. Hammers every read endpoint as B using A's IDs; every one should
       refuse — most return 404, some return content with zero overlap.
    5. Deletes user B at the end.

A must already exist with at least one ready document and ideally one
submitted assessment. The smoke test creates those if you've run it once.

Exit code:
    0  if every isolation check passes.
    1  if any check fails (the message tells you which).
"""
import os
import secrets
import string
import sys

from dotenv import load_dotenv
from supabase import create_client

import httpx


BASE = "http://localhost:8000"


def fail(name, hint=""):
    print(f"  ✗ {name}" + (f" — {hint}" if hint else ""))
    sys.exit(1)


def check(name, passes, *, hint=""):
    if passes:
        print(f"  ✓ {name}")
    else:
        fail(name, hint)


def main():
    load_dotenv()

    if len(sys.argv) < 3:
        print("usage: python -m tests.isolation_test <user_a_email> <user_a_password>",
              file=sys.stderr)
        sys.exit(1)

    email_a, password_a = sys.argv[1], sys.argv[2]
    url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    service_key = os.environ["SUPABASE_SERVICE_KEY"]

    anon = create_client(url, anon_key)
    admin = create_client(url, service_key)

    # ---- User A: log in and inventory their content ----
    print("User A")
    res_a = anon.auth.sign_in_with_password({"email": email_a, "password": password_a})
    token_a = res_a.session.access_token
    uid_a = res_a.user.id
    print(f"  ✓ signed in as {email_a} (uid={uid_a})")

    headers_a = {"Authorization": f"Bearer {token_a}"}
    with httpx.Client(base_url=BASE, headers=headers_a, timeout=60) as c:
        dash = c.get("/dashboard").json()
        hist = c.get("/history").json()

    a_docs = [d for d in dash["documents"] if d["status"] == "ready"]
    if not a_docs:
        fail("setup", "user A has no ready documents — upload one first")
    a_doc_id = a_docs[0]["id"]
    a_assess_id = hist["assessments"][0]["id"] if hist["assessments"] else None
    print(f"  using document: {a_doc_id}")
    print(f"  using assessment: {a_assess_id or '(none — some checks will be skipped)'}")

    # A's session for /ask leak test — created freshly so we know the ID
    with httpx.Client(base_url=BASE, headers=headers_a, timeout=60) as c:
        s = c.post("/session", json={"document_id": a_doc_id, "level": "novice"})
        a_session_id = s.json()["session_id"]
        c.post("/ask", json={
            "session_id": a_session_id, "document_id": a_doc_id,
            "question": "What is this material about?", "level": "novice",
        })
    print(f"  created seed session: {a_session_id}")

    # ---- User B: create a fresh confirmed user via admin API ----
    rand = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(10))
    email_b = f"iso-test-{rand}@example.com"
    password_b = secrets.token_urlsafe(20)

    created = admin.auth.admin.create_user({
        "email": email_b,
        "password": password_b,
        "email_confirm": True,
    })
    uid_b = created.user.id
    print(f"\nUser B (temporary): {email_b} (uid={uid_b})")

    try:
        res_b = anon.auth.sign_in_with_password({"email": email_b, "password": password_b})
        token_b = res_b.session.access_token
        headers_b = {"Authorization": f"Bearer {token_b}"}

        print("\nIsolation checks (B holding A's IDs)")

        with httpx.Client(base_url=BASE, headers=headers_b, timeout=60) as c:
            # --- Reads that should be empty for B ---
            r = c.get("/dashboard").json()
            b_doc_ids = {d["id"] for d in r["documents"]}
            check("/dashboard for B does not include A's documents",
                  a_doc_id not in b_doc_ids,
                  hint=f"saw A's doc in {b_doc_ids}")

            r = c.get("/history").json()
            b_assess_ids = {a["id"] for a in r["assessments"]}
            check("/history for B does not include A's assessments",
                  a_assess_id is None or a_assess_id not in b_assess_ids,
                  hint=f"saw A's assessment in {b_assess_ids}")

            # --- /history/{a_id}: 404 for B ---
            if a_assess_id:
                r = c.get(f"/history/{a_assess_id}")
                check("/history/{A's id} returns 404 for B",
                      r.status_code == 404,
                      hint=f"got HTTP {r.status_code}: {r.text[:200]}")

            # --- /revision/{A's doc}/misses: 200 with empty misses ---
            r = c.get(f"/revision/{a_doc_id}/misses")
            data = r.json() if r.status_code == 200 else {}
            check("/revision/{A's doc}/misses leaks nothing to B",
                  r.status_code == 200 and not data.get("misses"),
                  hint=f"got HTTP {r.status_code}: {data}")

            # --- /session creation against A's doc: 404 ---
            r = c.post("/session", json={"document_id": a_doc_id, "level": "novice"})
            check("/session refuses to create one on A's document",
                  r.status_code == 404,
                  hint=f"got HTTP {r.status_code}: {r.text[:200]}")

            # --- /lesson/start against A's doc: 404 ---
            r = c.post("/lesson/start", json={"document_id": a_doc_id, "level": "novice"})
            check("/lesson/start refuses A's document",
                  r.status_code == 404,
                  hint=f"got HTTP {r.status_code}: {r.text[:200]}")

            # --- /ask with A's session_id: 404 ---
            r = c.post("/ask", json={
                "session_id": a_session_id, "document_id": a_doc_id,
                "question": "What did we just talk about?",
                "level": "novice",
            })
            check("/ask refuses A's session_id",
                  r.status_code == 404,
                  hint=f"got HTTP {r.status_code}: {r.text[:200]}")

            # --- /lesson/next with A's session_id: 404 ---
            r = c.post("/lesson/next", json={"session_id": a_session_id})
            check("/lesson/next refuses A's session_id",
                  r.status_code == 404,
                  hint=f"got HTTP {r.status_code}: {r.text[:200]}")

            # --- /assessment/create against A's doc: 404 ---
            r = c.post("/assessment/create", json={
                "document_id": a_doc_id,
                "format": "objective", "level": "novice",
                "num_questions": 1, "time_limit_seconds": 60,
            })
            check("/assessment/create refuses A's document",
                  r.status_code == 404,
                  hint=f"got HTTP {r.status_code}: {r.text[:200]}")

            # --- /revision/practice against A's doc: 404 ---
            r = c.post("/revision/practice", json={
                "document_id": a_doc_id, "level": "novice", "num_questions": 1,
            })
            check("/revision/practice refuses A's document",
                  r.status_code == 404,
                  hint=f"got HTTP {r.status_code}: {r.text[:200]}")

            if a_assess_id:
                # --- /assessment/start with A's id: 404 ---
                r = c.post("/assessment/start", json={"assessment_id": a_assess_id})
                check("/assessment/start refuses A's assessment_id",
                      r.status_code == 404,
                      hint=f"got HTTP {r.status_code}: {r.text[:200]}")

                # --- /assessment/{a_id}/time: 404 ---
                r = c.get(f"/assessment/{a_assess_id}/time")
                check("/assessment/{A's id}/time refuses B",
                      r.status_code == 404,
                      hint=f"got HTTP {r.status_code}: {r.text[:200]}")

                # --- /answer/save against A's assessment: 404 ---
                fake_qid = "00000000-0000-0000-0000-000000000000"
                r = c.post("/answer/save", json={
                    "assessment_id": a_assess_id,
                    "question_id": fake_qid,
                    "student_answer": "leak attempt",
                })
                check("/answer/save refuses A's assessment_id",
                      r.status_code == 404,
                      hint=f"got HTTP {r.status_code}: {r.text[:200]}")

                # --- /assessment/submit on A's id: 404 ---
                r = c.post("/assessment/submit", json={"assessment_id": a_assess_id})
                check("/assessment/submit refuses A's assessment_id",
                      r.status_code == 404,
                      hint=f"got HTTP {r.status_code}: {r.text[:200]}")

        print("\nAll isolation checks passed.")

    finally:
        try:
            admin.auth.admin.delete_user(uid_b)
            print(f"\nCleanup: deleted temporary user {email_b}")
        except Exception as e:
            print(f"\nCleanup warning: could not delete temp user {uid_b}: {e}")


if __name__ == "__main__":
    main()
