# CLAUDE.md — Friday (AI Chief of Staff MVP)

Persistent instructions for building Friday consistently. Read this before implementing anything, and re-check it before any architectural decision.

## 0. Current Repo State (as of inspection)

This repo currently contains **only context and mock data** — no application code, no `package.json`, no backend, no existing CLAUDE.md. Actual folders found:

```
Context/
├── company-profile-bms.md
├── customers-bms.md
├── metrics-bms.md
├── products-services-bms.md
├── strategy-bms.md
└── team-bms.md

Mock Data/
├── calendar.json
├── pipeline.json
├── revenue.json
└── tasks.json
```

**Naming discrepancy to be aware of:** the spec below (and this doc) refers to `context/` and `mock-data/` in lowercase-kebab form, but the folders that actually exist on disk are `Context/` and `Mock Data/` (capitalized, with a space, and files suffixed `-bms`). Do not rename or move these existing files without the user's explicit go-ahead. When scaffolding the app:
- Either read directly from the existing `Context/` and `Mock Data/` paths, or
- Ask the user before introducing a renamed/duplicated `context/` + `mock-data/` structure.
Never silently duplicate data into two locations — pick one source of truth and reference it everywhere.

The company represented in the sample context/data is **BookMySales.ai** (B2B sales-meetings-as-a-service, "we double your sales meetings or you don't pay"). This is example/mock content for the MVP demo — treat it as data, not as product requirements.

---

## 1. Project Overview

Friday is an **AI Chief of Staff / AI Operating Layer** for founder-led SMBs. It helps a founder understand what needs attention, surface business problems, and take action. Friday should behave like an intelligent Chief of Staff — proactive, context-aware, opinionated when warranted — **not a generic chatbot**.

---

## 2. MVP Product Scope

Build only:
- Company/business context
- Daily founder intelligence
- Calendar and meetings
- Tasks and deadlines
- Sales pipeline
- Business/revenue insights
- Documents/context
- Conversational AI advisor (single chat)

**Explicitly out of scope for MVP** — do not build these unless the user asks:
- Multiple complex autonomous agents
- Mobile app
- Billing/Stripe payments
- Complex RBAC
- 15+ integrations
- Full workflow builder
- Production-grade enterprise infrastructure
- Over-engineered RAG
- Complex multi-agent architecture

If a task seems to require any of the above, stop and flag it rather than building it.

---

## 3. AI Architecture

Keep it simple:

```
Friday
 → Chief of Staff / Router
 → appropriate capability
 → shared company context + tools
 → Claude
 → response / recommendation
 → approval before important actions
```

**One chat interface only.** Do not build three separate chatbots or expose the capabilities as distinct UIs — they are internal routing concepts behind a single conversational surface.

At most 2–3 logical capabilities, all reachable from the same router:

- **A. Daily Intelligence** — proactively summarizes what the founder needs to know today: meetings, tasks/deadlines, pipeline movement, important context. Prioritizes what needs attention.
- **B. Business Advisor** — brainstorming, decision-making, project planning, team allocation, general business questions. Reasons over actual company context. Should challenge questionable assumptions rather than agreeing by default.
- **C. Business/Revenue Analyst** — analyzes pipeline, customers, revenue, metrics. Surfaces risks, opportunities, and revenue leakage.

The router picks the right capability (or blends them) per user message; the user never has to choose.

---

## 4. Company Context & Data

Context (markdown, read-only reference material for reasoning):
- company profile, team, strategy, customers, products/services, metrics

Mock operational data (JSON, stand-ins for future real integrations):
- `calendar.json` — mock for a calendar connector
- `revenue.json` — mock for a Stripe/revenue connector
- `pipeline.json` — mock for a CRM (e.g. Salesforce) connector
- `tasks.json` — tasks/deadlines

All of this is **dummy data for the MVP**. Hard rules:
- **Never hardcode** company facts, customer names, revenue numbers, meetings, tasks, or pipeline info into UI components or application logic.
- The app must **read and reason over** the context/data files at runtime — treat them as the database until a real one exists.
- If information isn't present in the context/data, Friday must say it doesn't have that information. **Never fabricate business data.**

---

## 5. UI Structure

Keep it extremely simple and uncluttered.

**Left navigation:**
- Home
- Company
- Tasks
- Profile

**Home** = executive dashboard, not a data dump. Should primarily show:
- Founder greeting ("Good morning …")
- Revenue + trend direction (up/down)
- Small trend chart
- Today's important meetings
- Past/overdue deadlines
- A few important AI insights
- "Ask Friday" assistant panel on the right (~30% width)

Do not put every piece of company information on Home.

**Company** section:
- Company profile, Team, Strategy, Customers, Products/Services, Metrics
- Should allow context files to be viewed (and later, updated)

**Tasks** section:
- Tasks, owners, deadlines, overdue items
- Initially sourced from `tasks.json`

**Profile** section: founder/user profile — keep minimal for MVP.

---

## 6. Data / Integrations

- Prefer mock/local data first. Do not add external integrations unless the task explicitly requires it.
- Future integrations (not MVP requirements): Google Calendar, Google Sheets/CRM, Google Drive, Stripe/revenue systems.
- Design data access behind a thin interface so a mock source can later be swapped for a real integration without touching UI or AI logic.

---

## 7. Technical Principles / Expected Stack

- **Frontend:** Next.js + React + TypeScript
- **UI:** Tailwind CSS
- **Backend/API:** Python + FastAPI
- **Database:** none for now (read from files)
- **Authentication:** deferred until a database exists
- **LLM:** any accessible API for now (Claude preferred where available)
- **Deployment:** TBD

Prefer simple, maintainable architecture over cleverness. Don't introduce a stack piece (DB, auth, queue, etc.) before it's actually needed.

---

## 8. AI Behavior

Friday should:
- Understand company context before answering.
- Use available data (context files + mock JSON) when answering business questions.
- Combine information across files/sources when the question needs it.
- Explain its reasoning clearly.
- Prioritize what's important; surface risks proactively.
- Challenge questionable assumptions instead of blindly agreeing.
- Never fabricate business data.
- Clearly distinguish facts (from data) vs. recommendations (its own reasoning).
- Ask for clarification only when genuinely necessary — not as a reflex.

**Worked example** — "We are starting the ABC project next week. How should I assign it across the team?" → Friday should inspect `team.md`, `customers.md`, `strategy.md`, and `tasks.json`, then give a reasoned recommendation grounded in those sources.

---

## 9. Action / Autonomy Model

Follow the ladder: **Observe → Recommend → Draft → Execute with approval → Autonomous**

For the MVP:
- **Read / analyze / recommend / draft** → can happen automatically.
- **Send / update CRM** (or anything externally visible) → requires explicit user approval before executing.
- **Delete / money-moving / other critical or irreversible changes** → not allowed in the MVP, period.

---

## 10. Development Principles

- Build the smallest useful version first; avoid over-engineering.
- Reuse existing project structure where possible.
- Keep business logic separate from UI.
- Keep AI logic separate from presentation.
- Use reusable components.
- Use environment variables for secrets; never expose API keys in frontend code.
- Keep customer/company data isolated (no leaking mock data structures into unrelated concerns).
- Write clear, maintainable code over clever code.
- Don't add a dependency unless it's justified.
- Before a major architectural change, explain why it's needed before doing it.

---

## 11. Development Workflow

For every feature:
1. Inspect the existing code.
2. Understand the current architecture.
3. Identify the smallest change required.
4. Implement it.
5. Run/build/test it.
6. Fix errors.
7. Only then move to the next feature.

Do not rewrite working code unnecessarily.

---

## 12. The Core Experience (north star)

A founder opens Friday and immediately understands:
- What is happening today
- What needs attention
- What is at risk
- What is happening with revenue/pipeline
- What meetings matter
- What deadlines are being missed

Then the founder can ask things like:
- "What should I focus on today?"
- "Which meeting should I not miss?"
- "Why is our pipeline slowing down?"
- "Where are we losing revenue?"
- "How should I assign this project?"
- "What am I forgetting?"
- "What should I do next?"

Every feature decision should be checked against whether it moves the product toward this experience — not away from it into unnecessary scope.
