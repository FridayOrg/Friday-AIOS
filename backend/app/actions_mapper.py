"""Runs the Playbook rules (playbook.py) over mock-data/opportunities.json and
mock-data/events.json to produce Actions (tab 40).

generate_actions() is called live by GET /actions in main.py on every request,
so "due today" / "overdue" are always computed against the real current date —
see build_actions()'s use of config.now(). There is no cached/written-to-disk
snapshot anymore: mock-data/generated_actions.json previously played that role
and went stale between manual reruns (see git history), which this replaces.

Can still be run directly (`python -m app.actions_mapper` from backend/) for a
quick manual check — it just prints the count rather than writing a file.

Northstar Legal has NO entry in mock-data/opportunities.json (removed
deliberately) — it's built live from HubSpot via playbook.build_live_opportunity()
below instead, as a proof the Playbook can run entirely against the real
system of record for one opportunity rather than the demo CRM snapshot.
See build_live_opportunity's docstring for what "live" covers (CRM, Meeting,
Calendar, Email) and _LIVE_OPPORTUNITIES for how to add another one.

No contact name is hardcoded here for Northstar either — matching against
live Meeting/Calendar/Email data is done by account name alone
(playbook._mentions), since HubSpot has no contact actually associated with
this deal to fetch live. A hardcoded "Daniel Price" string would have been
exactly the kind of non-integration-sourced value this file is meant to avoid
for Northstar; if a real contact gets added in HubSpot later, build_live_
opportunity can be extended to read it via the deal->contact Associations API.
"""

import json
import logging

from .config import MOCK_DATA_DIR
from .playbook import build_actions, build_live_opportunity

logger = logging.getLogger(__name__)

OPPORTUNITIES_PATH = MOCK_DATA_DIR / "opportunities.json"
EVENTS_PATH = MOCK_DATA_DIR / "events.json"

# (opportunity_id, account name) for opportunities with no mock-data/
# opportunities.json record at all — see module docstring.
_LIVE_OPPORTUNITIES = [
    ("OPP-002", "Northstar Legal"),
]


def generate_actions() -> list[dict]:
    opportunities = json.loads(OPPORTUNITIES_PATH.read_text(encoding="utf-8"))
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))

    for opportunity_id, account in _LIVE_OPPORTUNITIES:
        live_opp = build_live_opportunity(opportunity_id, account)
        if live_opp:
            opportunities.append(live_opp)
        else:
            logger.warning("No live HubSpot deal found for %s (%s) — skipped.", account, opportunity_id)

    return build_actions(opportunities, events)


def main() -> None:
    actions = generate_actions()
    print(f"Computed {len(actions)} actions (live, not written to a file)")


if __name__ == "__main__":
    main()
