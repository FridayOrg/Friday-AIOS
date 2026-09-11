"""
Runs the 10 test questions against Friday CLI's ask_friday(), with delay + retry
between calls to avoid the free-tier Gemini 503 "high demand" issue seen when firing
requests back-to-back. Writes results to test_run_output.md.
"""
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app.context_loader import build_system_prompt  # noqa: E402
from backend.app.llm_client import ask_friday  # noqa: E402
from backend.app.config import MODEL  # noqa: E402

QUESTIONS = [
    "What's on my calendar today, September 9, 2026?",
    "Which meetings this week should I not miss?",
    "What tasks are overdue or need immediate attention?",
    "Why is Ashcombe Industrial Supply behind pace, and should I be worried?",
    "Where are we at risk of losing revenue right now?",
    "How is MRR trending, and what's driving the change?",
    "Which client is our best case-study candidate for pitching the next cohort, and why?",
    "We're starting the ABC project next week - how should I assign it across the team?",
    "Should I approve Freya's RAG-based competitor intel automation proposal?",
    "What's our biggest strategic risk heading into the second cohort?",
]


def main():
    system_prompt = build_system_prompt()

    out_lines = [f"# Test Run Output — model: {MODEL}\n"]
    for i, q in enumerate(QUESTIONS, start=1):
        print(f"Running Q{i}...", flush=True)
        answer = None
        last_err = None
        for attempt in range(5):
            try:
                answer = ask_friday(system_prompt, q)
                break
            except Exception as e:
                last_err = e
                wait = 10 * (attempt + 1)
                print(f"  attempt {attempt+1} failed ({e}); waiting {wait}s...", flush=True)
                time.sleep(wait)
        if answer is None:
            answer = f"[FAILED after retries: {last_err}]"
        out_lines.append(f"## Q{i}: {q}\n\n{answer}\n")
        time.sleep(8)  # space out calls to avoid 503s

    Path(__file__).parent.joinpath("test_run_output.md").write_text(
        "\n".join(out_lines), encoding="utf-8"
    )
    print("Done. Wrote test_run_output.md")


if __name__ == "__main__":
    main()
