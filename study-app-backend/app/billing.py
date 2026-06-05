from datetime import date, datetime, timezone

from .clients import supabase


class LimitError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)


def get_plan(code):
    rows = supabase.table("plans").select("*").eq("code", code).execute().data
    return rows[0] if rows else None


def current_period():
    today = date.today()
    return date(today.year, today.month, 1).isoformat()


def get_usage(user_id):
    period = current_period()
    rows = supabase.table("usage").select("*") \
        .eq("user_id", user_id).eq("period_start", period).execute().data
    if rows:
        return rows[0]
    created = supabase.table("usage").insert({
        "user_id": user_id, "period_start": period,
    }).execute()
    return created.data[0]


def _parse(ts):
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def access_state(user_id):
    user = supabase.table("users").select(
        "plan, trial_ends_at, subscription_ends_at"
    ).eq("id", user_id).execute().data[0]
    now = datetime.now(timezone.utc)
    plan_code = user["plan"] or "basic"

    if plan_code == "basic":
        ends = _parse(user.get("trial_ends_at"))
        expired = bool(ends and ends < now)
        return {"plan": "basic", "active": not expired,
                "reason": "trial_expired" if expired else "trial"}

    ends = _parse(user.get("subscription_ends_at"))
    expired = (ends is None) or (ends < now)
    return {"plan": plan_code, "active": not expired,
            "reason": "subscription_expired" if expired else "subscribed"}


def check_and_count(user_id, kind):
    state = access_state(user_id)
    if not state["active"]:
        raise LimitError("Your access has ended. Choose a plan to continue.")

    plan = get_plan(state["plan"])

    if kind == "document":
        limit = plan["max_documents"]
        if limit is not None:
            res = supabase.table("documents").select("id", count="exact") \
                .eq("user_id", user_id).execute()
            if res.count >= limit:
                raise LimitError(f"Your plan allows {limit} documents.")
        return

    usage = get_usage(user_id)
    if kind == "question":
        limit, used, field = plan["max_questions"], usage["questions_used"], "questions_used"
    else:
        limit, used, field = plan["max_assessments"], usage["assessments_used"], "assessments_used"

    if limit is not None and used >= limit:
        raise LimitError(f"You have used your {limit} {kind}s for this month.")

    supabase.table("usage").update({field: used + 1}) \
        .eq("id", usage["id"]).execute()
