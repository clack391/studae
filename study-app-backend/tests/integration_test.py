"""Integration test for the endpoints the smoke test skips.

Usage:
    uv run python -m tests.integration_test

Covers the 4 endpoints not exercised by tests/smoke_test.py:
  - POST /upload (requires a real PDF + minutes of ingestion wait)
  - POST /ask-photo (requires an image)
  - POST /answer/save-photo (requires an image)
  - DELETE /me/account (destructive)

Creates a throwaway Supabase user via the admin API, exercises each
endpoint, and verifies the user is truly gone after the account-delete
call. Falls back to admin deletion if anything failed earlier.

Requires:
  - A PDF in data/ — uses Bonsai.pdf if present (smaller = faster), falls
    back to Houseplant Problems.pdf.
  - Uvicorn running (uv run uvicorn app.main:app --reload).
  - The same .env keys as the smoke test (SUPABASE_*, anon + service).

Cost: ~$0.05-0.10 in AI calls per run (1 upload OCR + 2 photo OCRs +
1 outline + 1 question gen). Time: 1-5 minutes depending on PDF size.
"""
import os
import secrets
import string
import struct
import sys
import time
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import create_client


BASE = "http://localhost:8000"


def make_tiny_png() -> bytes:
    """Build a valid 1x1 transparent RGBA PNG using only stdlib.
    Real OCR will read this as 'nothing' but the upload path still works."""
    def chunk(typ: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data)))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00" + b"\x00" * 4))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


TINY_PNG = make_tiny_png()


def fail(name, reason):
    print(f"  ✗ {name}: {reason}")
    sys.exit(1)


def check(name, response, *, must_have=()):
    if response.status_code >= 400:
        fail(name, f"HTTP {response.status_code}: {response.text[:300]}")
    try:
        data = response.json()
    except Exception:
        data = None
    for key in must_have:
        if data is None or key not in data:
            fail(name, f"missing '{key}' in response")
    print(f"  ✓ {name}")
    return data


def find_test_pdf() -> Path:
    repo_root = Path(__file__).parent.parent
    for name in ("Bonsai.pdf", "Houseplant Problems.pdf"):
        p = repo_root / "data" / name
        if p.exists():
            return p
    fail("setup", "no PDF in data/ — need Bonsai.pdf or Houseplant Problems.pdf")


def main():
    load_dotenv()
    pdf_path = find_test_pdf()
    print(f"Using PDF: {pdf_path.name} ({pdf_path.stat().st_size // 1024} KB)")

    url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    service_key = os.environ["SUPABASE_SERVICE_KEY"]

    anon = create_client(url, anon_key)
    admin = create_client(url, service_key)

    # --- Create throwaway user --------------------------------------------
    rand = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(10))
    email = f"int-test-{rand}@example.com"
    password = secrets.token_urlsafe(20)

    print(f"\nCreating temp user: {email}")
    created = admin.auth.admin.create_user({
        "email": email, "password": password, "email_confirm": True,
    })
    user_id = created.user.id
    print(f"  uid: {user_id}")

    # Upgrade to pro so plan limits don't bite during the test
    sub_end = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    admin.table("users").update({
        "plan": "pro",
        "subscription_ends_at": sub_end,
    }).eq("id", user_id).execute()

    deleted_via_endpoint = False

    try:
        res = anon.auth.sign_in_with_password({"email": email, "password": password})
        token = res.session.access_token
        headers = {"Authorization": f"Bearer {token}"}

        with httpx.Client(base_url=BASE, headers=headers, timeout=300) as c:

            # --- POST /upload + poll for ingestion -----------------------
            print("\nUpload + ingestion")
            with open(pdf_path, "rb") as f:
                up = c.post("/upload", files={"file": (
                    pdf_path.name, f, "application/pdf",
                )})
            data = check("/upload", up, must_have=("document_id", "status"))
            doc_id = data["document_id"]

            print("  polling for ingestion (max 15 min)", end="", flush=True)
            deadline = time.time() + 900
            ready = False
            while time.time() < deadline:
                dash = c.get("/dashboard").json()
                doc = next((d for d in dash["documents"] if d["id"] == doc_id), None)
                if not doc:
                    print()
                    fail("/upload polling", "document missing from dashboard")
                if doc["status"] == "ready":
                    ready = True
                    print()
                    print(f"  ✓ ingest complete (chunks via /documents/{{id}}/progress)")
                    break
                if doc["status"] == "failed":
                    print()
                    fail("/upload polling", "ingestion failed")
                print(".", end="", flush=True)
                time.sleep(5)
            if not ready:
                fail("/upload polling", "did not complete within 15 min")

            # --- POST /ask-photo ---------------------------------------
            print("\nPhoto endpoints")
            sess = c.post("/session", json={
                "document_id": doc_id, "level": "novice",
            })
            session_id = sess.json()["session_id"]

            r = c.post(
                "/ask-photo",
                files={"file": ("test.png", TINY_PNG, "image/png")},
                data={"session_id": session_id,
                      "document_id": doc_id,
                      "level": "novice"},
            )
            check("/ask-photo", r, must_have=("read_back", "answer", "sources"))

            # --- POST /answer/save-photo -------------------------------
            # Need an assessment + question to attach the photo to
            aid_resp = c.post("/assessment/create", json={
                "document_id": doc_id, "format": "theory",
                "level": "novice", "num_questions": 1,
            })
            aid = aid_resp.json()["assessment_id"]
            start = c.post("/assessment/start", json={"assessment_id": aid})
            qid = start.json()["questions"][0]["id"]

            r = c.post(
                "/answer/save-photo",
                files={"file": ("work.png", TINY_PNG, "image/png")},
                data={"assessment_id": aid, "question_id": qid},
            )
            check("/answer/save-photo", r, must_have=("read_back",))

            # --- DELETE /me/account ------------------------------------
            print("\nDestructive: DELETE /me/account")
            r = c.delete("/me/account")
            check("DELETE /me/account", r, must_have=("deleted",))
            deleted_via_endpoint = True

        # --- Verify the user is truly gone ----------------------------
        print("\nPost-deletion verification")
        try:
            anon.auth.sign_in_with_password({"email": email, "password": password})
            fail("post-deletion sign-in", "user can still sign in")
        except Exception as e:
            print(f"  ✓ sign-in fails ({type(e).__name__}) — user is gone")

        print("\nAll integration endpoints OK.")

    finally:
        if not deleted_via_endpoint:
            print(f"\nFallback cleanup: deleting temp user via admin API")
            try:
                admin.auth.admin.delete_user(user_id)
                print("  done")
            except Exception as e:
                print(f"  warning: admin delete also failed: {e}")


if __name__ == "__main__":
    main()
