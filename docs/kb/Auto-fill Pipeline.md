---
type: flow
tags: [flow, apply, autofill]
updated: 2026-08-06
---

# Auto-fill Pipeline

How a job URL becomes a filled (never submitted) application form. This is the
endgame of the whole [[Portal Session]] design: fill every login-gated portal
with the same saved Google session.

The auto-fill pipeline is the **fallback**, not the default. The app's Apply
routing is **email-first** ([[Android App]]): it drafts an application email and
scrapes the posting page for a real contact first; auto-fill only runs when no
application email exists on the page. The email path is the proven CLI strategy
(the 81-application run was mostly email applications); portal-form automation
is the fallback for postings with no reachable email.

As of 2026-08-04 the auto-fill engine is **validated on the ATS boards the
scanner actually surfaces** — Ashby, Lever, Greenhouse, and Workable — so a
posting with no email gets a real, working apply path, not a dead end. Workable
links come in as description-only `/jobs/view/{id}` URLs and are normalized to
the real `/j/{id}/apply` form; multi-option radio sets are collapsed into single
multiple-choice fields so a YES/NO group never surfaces as two phantom required
fields.

## Flow

```
Job URL → /apply/open → Playwright loads page
  → auth entry detected?
       yes → "Login with Google" → reuse saved session (no password needed)
       no  → straight to form
  → click Apply button (may open a tab) → click "Application" tab (Ashby/SPA)
  → form rendered?
       yes → extract fields → fill from cv.md + profile.yml
       no  → Ashby GraphQL API fallback (real labels + ids, drives fill-by-id)
  → attach CV (cvNote confirms) → report X/Y fields filled
  → STOP. No auto-submit ever.
```

## The three gates

1. **Login gate** — portal needs auth. The saved browser session from
   [[Portal Session]] authenticates silently; only if there is **no** session
   does the user get routed back to the portal login screen.
2. **Form gate** — after load, `isGoogleAuthPage()` ensures we never mistake
   Google's auth page for the application form ([[Google OAuth]] false-success
   trap).
3. **HITL gate** — filling and clicking are separated; the app shows the filled
   form and the user confirms before any submit action. See
   [[Security & Human-in-the-loop]].

## Pending questions — what the app may still ask

`/apply/open` returns `answers` plus `pending_questions` for fields that cannot
be auto-filled. The app renders them as inline cards and persists each answer to
`config/form-answers.yml` **keyed by category**, so a question is asked once and
reused across every future form.

Rules that keep the candidate from being re-asked for data they already gave
(`answerField` + `generateAnswers` in `apply-job.mjs`):

- **Resume** (`category 'resume'`): never guessed. If a resume **URL** was
  answered once (`form-answers.yml: resume`), text-box resume fields are filled
  with it; otherwise the field is `source: 'file'` and **no question is asked** —
  file inputs are filled by the CV-attach step with the JD-tailored PDF
  ([[CV & PDF Generation]]). A required resume field can no longer spawn a
  question when the CV is on file.
- **LinkedIn** (`category 'linkedin'`): resolved from `form-answers.yml` first,
  then `profile.yml candidate.linkedin` — never re-asked once either holds a
  value.
- **Candidate-confirmation categories** (experience, salaries, commute, notice,
  authorization, education): always surfaced as a question when empty, because
  guessing them would fabricate candidate data.
- Unknown required fields surface as `category: 'other'`.


## Target battery

Validated (2026-08-04): **Ashby** (`jobs.ashbyhq.com`) — tab-reveal + GraphQL
API fallback; **Lever** (`jobs.lever.co`) — clean extract/fill; **Greenhouse**
(`boards.greenhouse.io`) — standard field names; **Workable**
(`apply.workable.com`) — `/jobs/view/` → `/j/{id}/apply` normalization,
overlay-safe fills, radio-group collapsing. Remaining login-gated portals
(Internshala, Naukri, Shine, ...) still need an account session in the vault
([[Portal Session]]); the multi-portal test plan exercises those individually:
login ✓/✗, fields X/Y, CV attached ✓/✗.

## Related files

- `apply-job.mjs`
- `career-ops-app/.../CareerOpsApi.kt` (`/apply/open`, `/apply/fill`)

## Links

- [[Playwright Automation]] — engine
- [[Portal Session]] — the session it consumes
- [[Google OAuth]] — the constraint behind the login gate
- [[CV & PDF Generation]] — what gets attached
- [[Evaluation Engine]] — why apply (quality gate)
