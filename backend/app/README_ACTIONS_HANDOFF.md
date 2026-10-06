# Handoff: wiring Today's Priorities to real generated Actions

For Paval, for the Tue PM task ("Wire Today's Priorities to backend-generated
Actions"). `mock-data/actions.json` (your hardcoded placeholder, read by
`getActions()` in `frontend/lib/data.ts`) is untouched — nothing here changes it.

## What's new

Run `python -m app.actions_mapper` (from `backend/`) to generate
`mock-data/generated_actions.json` — real Actions computed from the Playbook rules
(`backend/app/playbook.py`, R-001–R-006) over `opportunities.json` + `events.json`,
instead of hand-typed.

## Field-shape diff you'll need to reconcile

Your `Action` interface uses camelCase; the generated output uses snake_case.
Same fields otherwise — one-to-one rename, no restructuring needed:

| Your `Action` interface | Generated field |
|---|---|
| `actionId` | `action_id` |
| `opportunityId` | `opportunity_id` |
| `whyNow` | `why_now` |
| `timeHorizon` | `time_horizon` |
| `userDecision` | `user_decision` |
| everything else (`priority`, `action`, `owner`, `due`, `status`, `deal`, `value`, `source`, `rule`, `notes`) | same name |

## Suggested swap

Simplest path: rename the generated file's keys to camelCase (either in
`actions_mapper.py` on our side, or a thin adapter in `getActions()` on yours —
your call), point `getActions()` at `generated_actions.json` instead of
`actions.json`, and confirm the UI renders unchanged.

## One heads-up on dates

The generated actions use the real current date (via `config.now()`) for "due
today" / "expected close has passed" checks — so the exact set of actions can
differ slightly day to day (e.g. a deal that was "due today" yesterday now shows
as overdue). This is intentional, not a bug — see the module docstrings in
`playbook.py` / `events_mapper.py` for why.
