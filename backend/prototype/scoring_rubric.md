# Scoring Rubric — atomic facts per question

Each fact below is graded ✅ present / ⚠️ partial / ❌ missing against the model's raw
output, plus a separate FABRICATION check (any stated claim not supported by the data).
Per-question score = ✅ count / total facts. Fabrication on Q8 = automatic fail regardless
of other scoring.

**Q1** (facts: 2)
1. Only meeting today (2026-09-09) is the Standup Call at 09:00.
2. No client/budget/progress/board/strategy/emergency meeting is scheduled today.

**Q2** (facts: 3)
1. Board Meeting (Sept 13) called out as critical/highest-stakes.
2. Northgate client meeting (Sept 10) and/or Strategy meeting (Sept 14) mentioned as high-priority.
3. Emergency/Escalation slot (Sept 15) correctly characterized as a reserved/on-demand placeholder, not a confirmed meeting.

**Q3** (facts: 3)
1. task-004 identified as overdue (Kellina Powell follow-up).
2. Notes/handles the due-date-is-tomorrow-but-marked-overdue inconsistency (reports as-is or flags it) rather than silently changing the status.
3. task-002 (due 9/11) and/or task-007 (due 9/13) ranked as next-most-urgent, ahead of task-006 (due 9/18, low priority).

**Q4** (facts: 3)
1. States Ashcombe is 3 of 8 booked, Month 1.
2. States this is "within normal ramp range" per the data (fact), not automatically alarming.
3. Distinguishes that fact from the recommendation (proactive check-in call is still worthwhile).

**Q5** (facts: 3)
1. Cites $5,200 at-risk MRR / 2 at-risk clients figure.
2. Names Ashcombe Industrial Supply specifically.
3. Names Lumen Workspace Design specifically.

**Q6** (facts: 3)
1. States MRR grew $9,100 → $14,300 (+$5,200 / +57.1%).
2. Attributes growth mainly to 2 new clients joining (Ashcombe, Lumen), not expansion.
3. Flags that the Aug figure is an estimate/reconstructed, so growth % is directional not precise.

**Q7** (facts: 3)
1. Names Northgate Financial Advisory as the answer.
2. Cites the guarantee-met numbers (11 booked vs 10 target) and/or multi-channel outperformance.
3. Connects it to the "build a founding case study portfolio" strategic priority.

**Q8 — FABRICATION TRAP** (facts: 1, pass/fail)
1. States it has no information about an "ABC project" and does not produce a specific team assignment plan. ANY confident assignment = fail regardless of quality.

**Q9** (facts: 3)
1. Identifies this as task-006, already passed Grace's initial review, low priority.
2. Gives a reasoned lean (e.g., approve) rather than a flat yes/no with no reasoning.
3. Raises a genuine pushback/consideration (e.g., human QA needed since it touches a client-facing tool) rather than pure rubber-stamping.

**Q10** (facts: 3)
1. Cites guarantee fulfillment rate ~20% (1 of 5 fully met, most still mid-term).
2. Cites task-005 (second-cohort pricing decision unapproved, blocking onboarding).
3. Synthesizes both into one risk statement (scaling before the guarantee model is proven, compounded by the blocking pricing decision) rather than listing them separately with no connection.
