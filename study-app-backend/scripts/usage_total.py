"""Sum LLM usage from data/usage.jsonl.

Usage:
    python -m scripts.usage_total              # all-time total + breakdown
    python -m scripts.usage_total today        # just today
    python -m scripts.usage_total week         # last 7 days
    python -m scripts.usage_total month        # last 30 days

Each line of data/usage.jsonl is one LLM call, written by clients.track_*.
"""
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

USAGE_FILE = Path(__file__).resolve().parent.parent / "data" / "usage.jsonl"


def _cutoff(arg: str | None):
    if not arg or arg == "all":
        return None
    now = datetime.now(timezone.utc)
    if arg == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if arg == "week":
        return now - timedelta(days=7)
    if arg == "month":
        return now - timedelta(days=30)
    raise SystemExit(f"unknown range: {arg}. use today | week | month | all")


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    cutoff = _cutoff(arg)
    label = arg or "all-time"

    if not USAGE_FILE.exists():
        print(f"no usage file at {USAGE_FILE} (no calls tracked yet)")
        return

    total_in = total_out = 0
    total_cost = 0.0
    n_calls = 0
    by_step = defaultdict(lambda: {"calls": 0, "in": 0, "out": 0, "cost": 0.0})
    by_model = defaultdict(lambda: {"calls": 0, "in": 0, "out": 0, "cost": 0.0})

    with USAGE_FILE.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if cutoff is not None:
                try:
                    ts = datetime.fromisoformat(row["ts"])
                except (KeyError, ValueError):
                    continue
                if ts < cutoff:
                    continue
            ti = int(row.get("input", 0) or 0)
            to = int(row.get("output", 0) or 0)
            tc = float(row.get("cost_usd", 0.0) or 0.0)
            total_in += ti
            total_out += to
            total_cost += tc
            n_calls += 1
            step = row.get("step", "unknown")
            model = row.get("model", "unknown")
            by_step[step]["calls"] += 1
            by_step[step]["in"] += ti
            by_step[step]["out"] += to
            by_step[step]["cost"] += tc
            by_model[model]["calls"] += 1
            by_model[model]["in"] += ti
            by_model[model]["out"] += to
            by_model[model]["cost"] += tc

    print(f"=== LLM usage ({label}) ===")
    print(f"calls:        {n_calls}")
    print(f"input tokens:  {total_in:,}")
    print(f"output tokens: {total_out:,}")
    print(f"TOTAL COST:    ${total_cost:.4f}")
    print()
    print("By step:")
    for step, v in sorted(by_step.items(), key=lambda kv: -kv[1]["cost"]):
        print(f"  {step:35s}  {v['calls']:5d} calls  in={v['in']:>10,}  out={v['out']:>10,}  ${v['cost']:.4f}")
    print()
    print("By model:")
    for model, v in sorted(by_model.items(), key=lambda kv: -kv[1]["cost"]):
        print(f"  {model:30s}  {v['calls']:5d} calls  in={v['in']:>10,}  out={v['out']:>10,}  ${v['cost']:.4f}")


if __name__ == "__main__":
    main()
