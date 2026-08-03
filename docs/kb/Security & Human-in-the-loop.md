---
type: boundary
tags: [boundary, rules, hitl, security]
updated: 2026-08-03
---

# Security & Human-in-the-loop

The non-negotiable rules that keep an automation-heavy system safe. If a design
choice conflicts with these, the choice loses.

## HITL rules

1. **Never auto-send** emails or applications. Draft → show → user confirms.
2. **Never auto-submit** application forms. Fill → show → user taps to submit.
3. Every evaluation below the quality bar is **recommended against** — apply
   only to strong fits.

## Truth rules

4. **Never fabricate claims.** CV/PDF generation reorders, reframes, emphasises
   what is already in `cv.md` / `config/profile.yml` — it never invents.
5. Google OAuth split is respected ([[Google OAuth]]): portal session is a
   browser credential, never treated as an API token and never shared across
   users ([[Multi-user Data Model]]).

## Operational rules

6. All data operations go through the [[Bridge Server]] API.
7. Portal credentials (where used) are stored encrypted per user; the preferred
   path is **no stored passwords at all** — one Google session instead.
8. Score < 4.0/5 → recommend against applying. Quality over quantity.

## Related files

- `AGENTS.md` (Critical Rules)
- `config/profile.yml` (allowed facts)

## Links

- [[Auto-fill Pipeline]] — the HITL gate on submit
- [[IMAP Email]] — the confirmation-before-send gate
- [[Google OAuth]] — credential discipline
- [[Evaluation Engine]] — the quality gate
