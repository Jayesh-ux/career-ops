# Career-Ops — Android AI Job Search Assistant

## What is career-ops

AI-powered job search automation: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing. The Android app connects to a Node.js bridge server which runs opencode as the AI brain.

## Critical Rules

- **NEVER auto-send emails or applications.** Draft only. User taps [Send]/[Apply] to confirm.
- **NEVER fabricate claims.** Keywords get reformulated, never invented. Read from `cv.md` and `config/profile.yml`.
- **NEVER claim authorship** the user doesn't have.
- Quality over quantity. Score below 4.0/5 = recommend against applying.

## Data Contract

**User Layer (personalization — NEVER auto-updated):**
- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `portals.yml`
- `data/*`, `reports/*`, `output/*`, `interview-prep/*`

**System Layer (auto-updatable):**
- `modes/_shared.md`, `modes/oferta.md`, `AGENTS.md`, `*.mjs` scripts, `templates/*`, `batch/*`

**THE RULE:** Customize user facts in `modes/_profile.md` or `config/profile.yml`. Never edit `modes/_shared.md` for user content.

## Source-of-Truth for Content

User-facing content comes ONLY from: `cv.md`, `article-digest.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `voice-data.md`, `interview-prep/`. Anything not in these files is out of scope.

## Main Files

| File | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Pending URLs inbox |
| `data/scan-history.tsv` | Scanner dedup history |
| `portals.yml` | Company + query config |
| `cv.md` | Canonical CV |
| `reports/` | Evaluation reports |
| `scan.mjs` | Portal scanner (zero LLM cost) |
| `set-status.mjs` | Update tracker status |
| `bridge-server.mjs` | REST API for Android app |

## Skill Modes

| User says... | Mode |
|--------------|------|
| Pastes JD or URL | `auto-pipeline` — evaluate + report + PDF + tracker |
| "Evaluate this offer" | `oferta` |
| "Compare offers" | `ofertas` |
| "Find contacts / outreach" | `contacto` |
| "Draft email" | `email` — draft only, never sends |
| "Research company" | `deep` |
| "Interview prep" | `interview-prep` |
| "Generate CV/PDF" | `pdf` |
| "Check app status" | `tracker` |
| "Fill application" | `apply` |
| "Scan for jobs" | `scan` |
| "Process pending URLs" | `pipeline` |
| "Batch evaluate" | `batch` |
| "Follow-up cadence" | `followup` |
| "Skill gap analysis" | `upskill` |

## Canonical Tracker States

`Evaluated` | `Applied` | `Responded` | `Interview` | `Offer` | `Rejected` | `Discarded` | `SKIP`

- No bold, no dates, no extra text in status column.
- Never add duplicate company+role entries. Update existing ones.

## Pipeline Rules

1. NEVER edit applications.md directly — use TSV in `batch/tracker-additions/` + `node merge-tracker.mjs`
2. Update status via `node set-status.mjs <report#|company> <State> [--note]`
3. After batch evaluations, run `node merge-tracker.mjs`
4. Health check: `node verify-pipeline.mjs`

## Report Format

Reports in `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`. Header must include `**URL:**` and `**Legitimacy:** {tier}`.

## Language Modes

`config/profile.yml` sets `language.output` (prose language) and `language.modes_dir` (market vocabulary). Output language is authoritative. Market modes supply context, not prose language.

Available: `modes/de/` (German/DACH), `modes/fr/` (French), `modes/ar/` (Arabic), `modes/ja/` (Japanese), `modes/tr/` (Turkish), `modes/hi/` (Hindi).
