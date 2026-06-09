"""Question-format integrity for generate_questions.

A theory test must contain only open-ended questions and an objective test
only multiple-choice; the leak that put MCQs into theory assessments came from
a prompt that always showed BOTH a "type":"objective" and a "type":"theory"
example (plus the MCQ rules) regardless of format. These tests pin both the
prompt-shaping fix and the server-side backstop. No network: track_claude is
monkeypatched to capture the prompt / return a canned payload.
"""
import json

import pytest

from app import assess


def _capture_prompt(monkeypatch):
    box = {}

    def fake_track(label, **kw):
        box["prompt"] = kw["messages"][0]["content"]

        class M:
            content = [type("x", (), {"text": '{"questions":[]}'})()]

        return M()

    monkeypatch.setattr(assess, "track_claude", fake_track)
    return box


def _return_payload(monkeypatch, questions):
    def fake_track(label, **kw):
        class M:
            content = [type("x", (), {"text": json.dumps({"questions": questions})})()]

        return M()

    monkeypatch.setattr(assess, "track_claude", fake_track)


# --- prompt shaping: the example + rules must match the requested format ----

def test_theory_prompt_has_no_objective_example_or_rules(monkeypatch):
    box = _capture_prompt(monkeypatch)
    assess.generate_questions("[chunk 0] material", ["c0"], "theory", "novice", 4)
    p = box["prompt"]
    assert '"type":"objective"' not in p          # no MCQ shape modeled
    assert '"type":"theory"' in p
    assert "For multiple choice: four options" not in p
    assert 'also include an "explanation"' not in p
    assert "For theory: a reference answer" in p


def test_objective_prompt_has_no_theory_example_or_rules(monkeypatch):
    box = _capture_prompt(monkeypatch)
    assess.generate_questions("[chunk 0] material", ["c0"], "objective", "novice", 4)
    p = box["prompt"]
    assert '"type":"theory"' not in p
    assert '"type":"objective"' in p
    assert "For multiple choice: four options" in p
    assert 'also include an "explanation"' in p


def test_mixed_prompt_keeps_both(monkeypatch):
    box = _capture_prompt(monkeypatch)
    assess.generate_questions("[chunk 0] material", ["c0"], "mixed", "novice", 4)
    p = box["prompt"]
    assert '"type":"objective"' in p and '"type":"theory"' in p
    assert "For multiple choice: four options" in p
    assert "For theory: a reference answer" in p


def test_prompt_json_shape_is_valid(monkeypatch):
    # The assembled shape_example must still parse as JSON for every format.
    box = _capture_prompt(monkeypatch)
    for fmt in ("theory", "objective", "mixed"):
        assess.generate_questions("[chunk 0] m", ["c0"], fmt, "novice", 4)
        shape = box["prompt"].split("in this shape:\n", 1)[1].split("\n\n", 1)[0]
        json.loads(shape)  # raises if malformed


# --- server-side backstop: off-format questions are dropped -----------------

def test_guard_drops_objective_from_theory(monkeypatch):
    _return_payload(monkeypatch, [
        {"type": "theory", "question": "q1"},
        {"type": "objective", "question": "q2"},
        {"type": "theory", "question": "q3"},
    ])
    out = assess.generate_questions("[chunk 0] m", ["c0"], "theory", "novice", 10)
    assert [q["type"] for q in out] == ["theory", "theory"]


def test_guard_drops_theory_from_objective(monkeypatch):
    _return_payload(monkeypatch, [
        {"type": "theory", "question": "q1"},
        {"type": "objective", "question": "q2"},
    ])
    out = assess.generate_questions("[chunk 0] m", ["c0"], "objective", "novice", 10)
    assert [q["type"] for q in out] == ["objective"]


def test_guard_keeps_both_for_mixed(monkeypatch):
    _return_payload(monkeypatch, [
        {"type": "theory", "question": "q1"},
        {"type": "objective", "question": "q2"},
    ])
    out = assess.generate_questions("[chunk 0] m", ["c0"], "mixed", "novice", 10)
    assert [q["type"] for q in out] == ["theory", "objective"]
