---
type: flow
tags: [flow, apply, autofill]
updated: 2026-08-04
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
is the gap to be trained and validated portal-by-portal later.

## Flow

```
Job URL → /apply/open → Playwright loads page
  → auth entry detected?
       yes → "Login with Google" → reuse saved session (no password needed)
       no  → straight to form
  → form rendered? → extract fields → fill from cv.md + profile.yml
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

## Target battery

The multi-portal test plan exercises: Internshala, Naukri, Shine, TimesJobs,
iimjobs, Foundit, Instahyre (+ backups) — each with a per-portal report:
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
