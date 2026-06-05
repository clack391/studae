"""Sign in to Supabase as an existing user and print the access token.

Usage:
    uv run python get_token.py <email> <password>

Requires SUPABASE_ANON_KEY in .env (Project Settings → API → anon public key).
"""
import os
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

if len(sys.argv) != 3:
    print("usage: python get_token.py <email> <password>", file=sys.stderr)
    sys.exit(1)

email, password = sys.argv[1], sys.argv[2]

client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_ANON_KEY"],
)
res = client.auth.sign_in_with_password({"email": email, "password": password})
print(res.session.access_token)
