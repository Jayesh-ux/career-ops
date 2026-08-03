---
type: tool
tags: [tool, cv, pdf]
updated: 2026-08-03
---

# CV & PDF Generation

Produces ATS-optimized CV PDFs and cover letters from the per-user source
files. Feeds the [[Auto-fill Pipeline]] and application emails.

## What exists

- `generate-pdf.mjs` — Playwright HTML → PDF, ATS-safe templates
- `generate-latex.mjs` / `build-cv-latex.mjs` — LaTeX pipeline
- `generate-cover-letter.mjs` — tailored cover letters
- `templates/` + `fonts/` — ATS templates

## Truth rule

Only reorder/reframe/emphasise what is in `cv.md` and `config/profile.yml` —
never invent. The CV attached to a portal form or email must match the file the
user maintains ([[Security & Human-in-the-loop]]).

## Related files

- `generate-pdf.mjs`, `cv.md`, `config/profile.yml`
- `templates/cv-template.html`

## Links

- [[Auto-fill Pipeline]] — CV attachment
- [[Evaluation Engine]] — per-role personalisation
- [[Security & Human-in-the-loop]] — no fabrication
- [[Playwright Automation]] — the PDF engine
- [[Multi-user Data Model]] — per-user cv.md
