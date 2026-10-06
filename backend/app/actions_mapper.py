"""Runs the Playbook rules (playbook.py) over mock-data/opportunities.json and
mock-data/events.json and writes the resulting Actions to
mock-data/generated_actions.json — the Tuesday AM output (tab 40).

Written to a separate file from mock-data/actions.json on purpose: that file is
Paval's hand-authored placeholder, already wired into the "Today's Priorities" UI
(frontend/lib/data.ts's getActions(), frontend/app/api/actions/route.ts). Swapping
the UI over to this real, rule-generated data is Paval's Tue PM task — see
backend/app/README_ACTIONS_HANDOFF.md for the field-shape differences she needs to
reconcile.

Run directly (`python -m app.actions_mapper` from backend/) to regenerate.
"""

import json

from .config import MOCK_DATA_DIR
from .playbook import build_actions

OPPORTUNITIES_PATH = MOCK_DATA_DIR / "opportunities.json"
EVENTS_PATH = MOCK_DATA_DIR / "events.json"
ACTIONS_OUTPUT_PATH = MOCK_DATA_DIR / "generated_actions.json"


def main() -> None:
    opportunities = json.loads(OPPORTUNITIES_PATH.read_text(encoding="utf-8"))
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))

    actions = build_actions(opportunities, events)

    ACTIONS_OUTPUT_PATH.write_text(json.dumps(actions, indent=2), encoding="utf-8")
    print(f"Wrote {len(actions)} actions to {ACTIONS_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
