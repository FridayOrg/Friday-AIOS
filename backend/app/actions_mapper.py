"""Runs the Playbook rules (playbook.py) over mock-data/opportunities.json and
mock-data/events.json to produce Actions (tab 40).

generate_actions() is called live by GET /actions in main.py on every request,
so "due today" / "overdue" are always computed against the real current date —
see build_actions()'s use of config.now(). There is no cached/written-to-disk
snapshot anymore: mock-data/generated_actions.json previously played that role
and went stale between manual reruns (see git history), which this replaces.

Can still be run directly (`python -m app.actions_mapper` from backend/) for a
quick manual check — it just prints the count rather than writing a file.
"""

import json

from .config import MOCK_DATA_DIR
from .playbook import build_actions

OPPORTUNITIES_PATH = MOCK_DATA_DIR / "opportunities.json"
EVENTS_PATH = MOCK_DATA_DIR / "events.json"


def generate_actions() -> list[dict]:
    opportunities = json.loads(OPPORTUNITIES_PATH.read_text(encoding="utf-8"))
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    return build_actions(opportunities, events)


def main() -> None:
    actions = generate_actions()
    print(f"Computed {len(actions)} actions (live, not written to a file)")


if __name__ == "__main__":
    main()
