"""Set a user's subscription plan and end date.

Usage:
    python -m scripts.set_plan <email> <plan> [--days N]

Examples:
    python -m scripts.set_plan student@example.com standard
    python -m scripts.set_plan student@example.com pro --days 365
    python -m scripts.set_plan student@example.com basic

Behavior:
    - basic           — clears subscription_ends_at. trial_ends_at is left as-is
                        (this script does not grant fresh trials).
    - standard / pro  — sets subscription_ends_at to now() + days (default 30).

Notes:
    - Plan must be a row in the public.plans table.
    - This uses the service-role Supabase client and bypasses RLS.
    - Monthly usage counters are NOT reset; if the user has hit caps under a
      smaller plan and you upgrade them, the new (larger) cap simply takes effect.

# upgrade your test account
uv run python -m scripts.set_plan clack391@gmail.com pro --days 3650

# upgrade a real user for a month
uv run python -m scripts.set_plan student@example.com standard

# 1-year subscription
uv run python -m scripts.set_plan student@example.com pro --days 365


# revert someone to basic (clears subscription, leaves trial alone)
uv run python -m scripts.set_plan student@example.com basic
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone

from app.clients import supabase


def main():
    p = argparse.ArgumentParser(prog="set_plan")
    p.add_argument("email")
    p.add_argument("plan")
    p.add_argument("--days", type=int, default=30,
                   help="subscription length in days (ignored for basic; default 30)")
    args = p.parse_args()

    valid_plans = {row["code"] for row in
                   supabase.table("plans").select("code").execute().data or []}
    if args.plan not in valid_plans:
        print(f"unknown plan '{args.plan}'. valid: {sorted(valid_plans)}",
              file=sys.stderr)
        sys.exit(1)

    rows = supabase.table("users") \
        .select("id, plan, trial_ends_at, subscription_ends_at") \
        .eq("email", args.email).execute().data
    if not rows:
        print(f"no user with email {args.email}", file=sys.stderr)
        sys.exit(1)
    user = rows[0]

    print(f"before: plan={user['plan']}  "
          f"trial_ends={user['trial_ends_at']}  "
          f"sub_ends={user['subscription_ends_at']}")

    patch = {"plan": args.plan}
    if args.plan == "basic":
        patch["subscription_ends_at"] = None
    else:
        patch["subscription_ends_at"] = (
            datetime.now(timezone.utc) + timedelta(days=args.days)
        ).isoformat()
    supabase.table("users").update(patch).eq("id", user["id"]).execute()

    after = supabase.table("users") \
        .select("plan, trial_ends_at, subscription_ends_at") \
        .eq("id", user["id"]).execute().data[0]
    print(f"after:  plan={after['plan']}  "
          f"trial_ends={after['trial_ends_at']}  "
          f"sub_ends={after['subscription_ends_at']}")


if __name__ == "__main__":
    main()
