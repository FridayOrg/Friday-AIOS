# Proposal brain (SharePoint Designs)

Company knowledge the proposal generator gives the AI as context on every request.
Backend-only: nothing in this folder is ever sent to the browser.

| File | What it holds |
|---|---|
| `company.md` | Profile, why SPD, security and compliance, standard technical statements |
| `products.md` | Products and services, with descriptions and default list prices |
| `pricing.md` | Pricing rules, payment milestone patterns, warranty and support |
| `standard_text.md` | Terms and conditions, change requests, methodology, client responsibilities, exclusions, assumptions, delivery patterns |
| `references.md` | Published case studies and the rule for when to use them |
| `sections.md` | Master section list: every section a proposal can contain and when to include it |

Conventions:
- `[To be determined per client]` marks anything that varies per deal. The AI copies it
  into the proposal (shown in red) unless the meeting notes supply the value.
- `[Client]` is replaced with the client's name.
- Design rules (fonts, colours, logos, header, footer) are not here. They live in the
  Word builder code, so the AI never sees or changes them.
