---
type: component
tags: [component, playwright, browser]
updated: 2026-08-03
---

# Playwright Automation

The browser engine behind portal work. `playwright-core` runs a persistent
Chromium profile so that a login done once ([[Portal Session]]) is remembered by
every later run.

## Scripts

| Script | Job |
|--------|-----|
| `apply-job.mjs` | Open a job URL, detect the auth entry, fill the form with CV data, attach the CV — never submits |
| `login-session.mjs` | **Fallback** interactive Google login (live screenshot/tap/type surface + `autoDrive()`), for troubleshooting / power users |
| `seed-cookies.mjs` | Shared cookie seeding + stealth: `seedGoogleCookies()` injects the WebView session cookies into the profile; `stealthInitScript()` hides automation |
| `scan.mjs` | Portal/job-board scanning ([[Job Scanning]]) |
| `smoke-pw.mjs` | Backend health check: launches browser, loads a page, reports what it detects |

## Environment notes

- Runs headless with `--no-sandbox`; browser binary is resolved from
  `/opt/ms-playwright` (copied from the user cache on first run).
- The profile path is per-user: `data/users/<email>/.pwprofile`.
- Persistent profile = **session cookies outlive the process** — this is the
  entire trick that makes one login cover many portals.
- At launch, both `login-session.mjs` and `apply-job.mjs` call
  `seedGoogleCookies(context, userDir)` (reading `google-cookies.json` seeded
  by the app's WebView login) and `addInitScript(stealthInitScript())` — so a
  portal is already signed in before the page loads.

## Key detection helpers (apply-job.mjs)

- `isGoogleAuthPage()` — treat `accounts.google.com` as "no form", preventing
  the false-success bug ([[Google OAuth]]).
- `findAuthEntry()` / `describeAuthState()` — figure out whether a job page
  needs login and how to enter it (Google button, email field, password).
- `cvNote` — confirmation that the CV file was attached, included in fill output.

## Related files

- `seed-cookies.mjs`
- `apply-job.mjs`
- `login-session.mjs`
- `smoke-pw.mjs`
- `scan.mjs`

## Links

- [[Portal Session]] — the login flow it powers
- [[Auto-fill Pipeline]] — the form-filling consumer
- [[Bridge Server]] — spawns these scripts per request
- [[Job Scanning]] — discovery use of Playwright
- [[CV & PDF Generation]] — produces the CV that gets attached
