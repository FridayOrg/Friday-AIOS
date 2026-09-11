# Friday Prototype — 10 Test Questions & Reference Answers

Purpose: run each question through `friday_cli.py` and compare the model's answer
against the reference answer below (grounded directly in the actual context/mock-data
files). This checks recall accuracy, cross-file reasoning, prioritization, and — most
importantly — whether the model correctly says "I don't have that information" instead
of inventing something, where relevant (Q8 and, partially, Q3).

Today's reference date in the data is **2026-09-09** (`tasks.json` last_updated,
`calendar.json` week_start).

---

### Q1 — Daily Intelligence (recall)
**Ask:** "What's on my calendar today, September 9, 2026?"
**Reference answer:** Only the daily 09:00 Standup Call (15 min, online, CEO + Team
Leads) — it's the only meeting in `calendar.json` with an occurrence/date of 2026-09-09.
No client, budget, progress, board, strategy, or emergency meetings are scheduled today.

---

### Q2 — Daily Intelligence (prioritization)
**Ask:** "Which meetings this week should I not miss?"
**Reference answer:** Should flag the **Board Meeting (Sept 13, critical priority,
90 min)** — quarterly performance review and strategic decisions with the board — as
the single highest-stakes meeting. Should also mention the **Client Meeting with
Northgate Financial Advisory (Sept 10, high priority)** since Northgate is mid-renewal
decision, and the **Strategy Meeting (Sept 14, high priority)**. The Emergency/Escalation
slot on Sept 15 is a critical-priority placeholder, not a confirmed meeting — a good
answer should note it's reserved/on-demand rather than treat it as a fixed must-attend.

---

### Q3 — Daily Intelligence (overdue/urgent tasks)
**Ask:** "What tasks are overdue or need immediate attention?"
**Reference answer:** `task-004` (follow up with Kellina Powell re: speaking engagement)
is explicitly marked `status: overdue` in the data even though its due date (2026-09-10)
is technically tomorrow relative to today (2026-09-09) — a good answer reports the data's
stated status as-is (or notes the inconsistency) rather than silently "fixing" it.
Next most urgent: `task-002` (Ashcombe escalation, due 2026-09-11, high priority) and
`task-007` (Lumen escalation, due 2026-09-13, high priority) — both should be flagged
ahead of lower-priority/later-due items like `task-006` (due 2026-09-18, low priority).

---

### Q4 — Cross-file reasoning (tasks + pipeline + customers)
**Ask:** "Why is Ashcombe Industrial Supply behind pace, and should I be worried?"
**Reference answer:** Ashcombe is Month 1 with 3 of 8 target meetings booked —
per Client Success's own note (`task-002`), this is "within normal ramp range," not
actually off-track by the data's own standard, even though the client contact has
expressed concern. `revenue.json` marks Ashcombe as `revenue_risk: medium`, not high.
A good answer distinguishes the fact (normal ramp range per data) from the
recommendation (a proactive CEO check-in call is still worthwhile to manage the
relationship/perception, as Client Success suggested) — not blind alarm.

---

### Q5 — Business/Revenue Analyst
**Ask:** "Where are we at risk of losing revenue right now?"
**Reference answer:** `revenue.json`'s Sept snapshot shows **$5,200 at-risk MRR across
2 clients**. Cross-referencing `revenue_by_client`, the two flagged `revenue_risk: medium`
clients are **Ashcombe Industrial Supply** ($2,800/mo) and **Lumen Workspace Design**
($2,400/mo) — together $5,200, matching the at-risk figure. A good answer names both
clients specifically, not just the aggregate number.

---

### Q6 — Business/Revenue Analyst (trend + data-quality awareness)
**Ask:** "How is MRR trending, and what's driving the change?"
**Reference answer:** MRR grew from $9,100 (Aug 9 snapshot) to $14,300 (Sep 9 snapshot),
+$5,200 (+57.1%), driven mainly by **2 new clients joining** (Ashcombe, Lumen) rather
than expansion of existing accounts. A strong answer should also flag that the Aug
figure is explicitly marked `"data_quality": "estimated"` / reconstructed, not real
historical data — so the growth % should be treated as directional, not precise
(the file says this outright). Marking down the model if it states 57.1% growth as a
hard fact without this caveat.

---

### Q7 — Business Advisor (synthesis: customers + strategy + metrics)
**Ask:** "Which client is our best case-study candidate for pitching the next cohort, and why?"
**Reference answer:** **Northgate Financial Advisory** — the only client to have fully
met its guarantee (11 booked vs. 10 target, Month 3), it outperformed using a
multi-channel (email + LinkedIn) approach, and it's already in renewal discussions
beyond the Launch Special — directly matching the strategic priority in `strategy.md`
of "building a founding case study portfolio." A good answer cites the specific numbers
and connects it to that stated strategic priority, not just "Northgate is doing well."

---

### Q8 — Fabrication trap (Business Advisor)
**Ask:** "We're starting the ABC project next week — how should I assign it across the team?"
**Reference answer:** There is **no "ABC project"** anywhere in `tasks.json`,
`strategy.md`, `calendar.json`, or any other file. The correct answer is for Friday to
say it has no information about an "ABC project" and ask what it refers to — **not**
to invent a plausible-sounding team assignment. This is the single most important
question in this set: any confident, specific assignment plan here is a fabrication
failure, regardless of how reasonable it sounds.

---

### Q9 — Business Advisor (reasoning + challenging assumptions)
**Ask:** "Should I approve Freya's RAG-based competitor intel automation proposal?"
**Reference answer:** This is `task-006` — low priority, due 2026-09-18, already passed
Grace Whitfield's initial review, touches the client-facing free "Competitor Intel
Request" tool. `team.md` establishes that AI Strategy proposals are meant to be
proposal-first and reviewed by Client Success before implementation (already satisfied
here). A good answer gives a reasoned lean (e.g., approve given it's already vetted and
low-risk) but should also raise a legitimate challenge: it touches a client-facing
output, so quality/accuracy of the automated report matters — worth confirming a human
QA step remains before reports go out, consistent with the company's stated "AI speed +
human judgment" value in `company-profile.md`. Should not just rubber-stamp "yes."

---

### Q10 — Cross-file strategic synthesis (Advisor + Analyst)
**Ask:** "What's our biggest strategic risk heading into the second cohort?"
**Reference answer:** A strong answer connects several files: `strategy.md` states the
company's posture is to prove the guarantee works before scaling; but `metrics.md`
shows the guarantee fulfillment rate is only 20% (1 of 5 fully met) with most clients
still mid-term; and `task-005` shows the **second-cohort pricing decision is still
unapproved and is explicitly blocking onboarding** of new clients. The risk: pushing
into a second cohort before the guarantee model is proven repeatable across industries
(the stated strategic priority) — compounded by an unresolved, blocking pricing decision.
A good answer surfaces this tension rather than just restating either fact alone.

---

## How to run these

```
cd backend/prototype
../../.venv/Scripts/python.exe friday_cli.py "What's on my calendar today, September 9, 2026?"
```

or launch interactively and paste each question one at a time:

```
../../.venv/Scripts/python.exe friday_cli.py
```
