"""Re-run just the 5 flagged questions (Q2, Q3, Q6, Q9, Q10) with the tightened
system prompt, to check whether the specific gaps found in the first pass improved."""
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app.context_loader import build_system_prompt  # noqa: E402
from backend.app.llm_client import ask_friday  # noqa: E402
from backend.app.config import MODEL  # noqa: E402

RETEST_QUESTIONS = {
    "Q2": "Which meetings this week should I not miss?",
    "Q3": "What tasks are overdue or need immediate attention?",
    "Q6": "How is MRR trending, and what's driving the change?",
    "Q9": "Should I approve Freya's RAG-based competitor intel automation proposal?",
    "Q10": "What's our biggest strategic risk heading into the second cohort?",
}


def main():
    system_prompt = build_system_prompt()

    out_lines = [f"# Retest Output (tightened prompt) — model: {MODEL}\n"]
    for label, q in RETEST_QUESTIONS.items():
        print(f"Running {label}...", flush=True)
        answer = None
        last_err = None
        for attempt in range(4):
            try:
                answer = ask_friday(system_prompt, q)
                break
            except Exception as e:
                last_err = e
                wait = 8 * (attempt + 1)
                print(f"  attempt {attempt+1} failed ({e}); waiting {wait}s...", flush=True)
                time.sleep(wait)
        if answer is None:
            answer = f"[FAILED after retries: {last_err}]"
        out_lines.append(f"## {label}: {q}\n\n{answer}\n")
        time.sleep(6)

    Path(__file__).parent.joinpath("retest_output.md").write_text(
        "\n".join(out_lines), encoding="utf-8"
    )
    print("Done. Wrote retest_output.md")


if __name__ == "__main__":
    main()
