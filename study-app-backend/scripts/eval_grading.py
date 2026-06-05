"""Compare Claude's theory grading against your own marks.

Add more samples grounded in your real material. Where Claude and you
disagree by 0.5 marks or more, the line is flagged — read the reasoning
and decide whether to tune the rubric, the grading prompt, or your own
expectation.

Usage:
    uv run python eval_grading.py
"""
from app.assess import grade_theory

samples = [
    {
        "question_text": "Explain why plants need sunlight.",
        "reference_answer": "Plants use sunlight in photosynthesis to make food.",
        "rubric": [
            {"point": "mentions photosynthesis", "marks": 1},
            {"point": "links sunlight to making food or energy", "marks": 1},
        ],
        "points": 2,
        "student_answer": "Plants turn sunlight into food, that process is photosynthesis.",
        "human_score": 2,
    },
    {
        "question_text": "What does the word 'bonsai' mean?",
        "reference_answer": "Bonsai is a Japanese word: 'bon' means shallow pot and 'sai' means plant, so bonsai means a plant in a shallow pot.",
        "rubric": [
            {"point": "translates 'bon' as pot (or shallow pot)", "marks": 1},
            {"point": "translates 'sai' as plant", "marks": 1},
        ],
        "points": 2,
        "student_answer": "It means a plant grown in a small pot.",
        "human_score": 1,
    },
    {
        "question_text": "Describe the Chokkan style of bonsai.",
        "reference_answer": "Chokkan is the formal upright style — a single tree with a perfectly straight, vertical trunk.",
        "rubric": [
            {"point": "identifies it as formal upright", "marks": 1},
            {"point": "describes the trunk as straight or vertical", "marks": 1},
        ],
        "points": 2,
        "student_answer": "The trunk stands straight up.",
        "human_score": 1,
    },
    {
        "question_text": "Where did bonsai originate?",
        "reference_answer": "Bonsai originated in China, then spread to Japan where the art was perfected.",
        "rubric": [
            {"point": "names China as the origin", "marks": 2},
        ],
        "points": 2,
        "student_answer": "It started in Japan.",
        "human_score": 0,
    },
]

for s in samples:
    _, score, reasoning = grade_theory(s, s["student_answer"])
    gap = score - s["human_score"]
    flag = "" if abs(gap) < 0.5 else "  <-- check this"
    print(f"human {s['human_score']}  claude {score}{flag}")
    print(f"   Q: {s['question_text']}")
    print(f"   A: {s['student_answer']}")
    print(f"   reasoning: {reasoning}\n")
