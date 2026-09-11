"""
Friday — Prototype CLI (thin wrapper around backend/app for manual terminal testing)

This script no longer duplicates context-loading or LLM-call logic — it reuses the
same backend/app modules the FastAPI server uses (backend/app/context_loader.py,
backend/app/llm_client.py), so testing here always reflects what the real API does.

Usage:
    python friday_cli.py                        # interactive loop
    python friday_cli.py "What needs my attention today?"   # single question
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # so `backend.app` imports work

from backend.app.context_loader import build_system_prompt  # noqa: E402
from backend.app.llm_client import ask_friday  # noqa: E402


def main():
    system_prompt = build_system_prompt()
    print(f"[Friday CLI] System prompt size: {len(system_prompt)} characters\n")

    # One-off mode: python friday_cli.py "question here"
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
        print(f"> {question}\n")
        print(ask_friday(system_prompt, question))
        return

    # Interactive mode
    print("Friday CLI — type a question, or 'exit' to quit.\n")
    while True:
        try:
            question = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break
        if not question:
            continue
        if question.lower() in {"exit", "quit"}:
            break
        answer = ask_friday(system_prompt, question)
        print(f"\n{answer}\n")


if __name__ == "__main__":
    main()
