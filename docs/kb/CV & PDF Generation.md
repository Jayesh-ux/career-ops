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
- `POST /cv/tailor` ([[Bridge Server]]) — per-role tailored CV PDF. Split
  design: the bridge gathers all context (JD, evaluation report, skill-gap
  classifier, resolved template) into one focused opencode call that returns the
  render JSON; the bridge then runs `build-cv-html.mjs` → `verify-cv-facts.mjs`
  (hard **fact gate**) → `generate-pdf.mjs`, retrying up to 3× with rejected
  claims fed back. Zero-LLM pieces: `jd-skill-gap.mjs` (skill classifier,
  `--summary` only used when it found skills), `cv-templates.mjs resolve cv`
  (honors `CAREER_OPS_PROFILE`). Artifacts are per-user (`jds/`, `output/`,
  `data/pdf-index.tsv`); `--user-dir` must be the SPACED form and
  `--allow-reorder` is required (template owns section order, see `modes/pdf.md`).

## Truth rule

Only reorder/reframe/emphasise what is in `cv.md` and `config/profile.yml` —
never invent. The CV attached to a portal form or email must match the file the
user maintains ([[Security & Human-in-the-loop]]).

## Related files

- `generate-pdf.mjs`, `cv.md`, `config/profile.yml`
- `templates/cv-template.html`
- `build-cv-html.mjs`, `verify-cv-facts.mjs`, `cv-templates.mjs`, `jd-skill-gap.mjs` — the `/cv/tailor` pipeline
- `modes/pdf.md` — the JSON render schema + section-order rules

## Links

- [[Auto-fill Pipeline]] — CV attachment
- [[Evaluation Engine]] — per-role personalisation
- [[Security & Human-in-the-loop]] — no fabrication
- [[Playwright Automation]] — the PDF engine
- [[Multi-user Data Model]] — per-user cv.md
- [[Bridge Server]] — the `/cv/tailor` endpoint that drives this pipeline
