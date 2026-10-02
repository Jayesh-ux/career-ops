---
type: component
tags: [component, playwright, browser]
updated: 2026-08-04
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
- `detectLoginWall()` — **2026-08-03 fix:** also treats full-page auth redirects
  (`/registration`, `/login`, `/signin`, `/signup`, `/auth`) as a login wall, so
  portals that bounce unauthenticated visitors (Internshala → `/registration/student`)
  now trigger the auto-login flow instead of reporting "no form fields".
- `checkBotCookies()` — **2026-08-03 fix:** bot cookies (`cf_clearance`, `bm_sz`,
  ...) are **site-scoped**. Previously ANY such cookie in the reusable persistent
  profile — including a stale Internshala challenge cookie left from an earlier
  run — aborted every later fill, even Cloudflare-free company ATS pages
  (Greenhouse/Ashby/Lever). Now only a bot cookie whose domain matches the page
  being filled counts as a block. This was the "apply via app was broken" cause.
- `cvNote` — confirmation that the CV file was attached, included in fill output.
- **2026-08-04 fixes (the "job is not posting" batch):**
  - `revealApplicationTab()` — Ashby (and tabbed SPA boards) put the form behind
    an **"Application" tab**, not an Apply button; without a click the form never
    mounts and extraction returns 0 fields. The engine now polls for and clicks
    the tab (skipping Overview / already-submitted states) before extracting.
  - `extractAshbyFormViaApi()` — browserless Ashby extraction via the public
    non-user GraphQL endpoint (`ApiJobPosting`): returns real labels, types,
    required flags, and ids that match the DOM input ids. Used as a fallback when
    the SPA won't hydrate, and to drive fill-by-id in `--fill` mode.
  - Label resolution priority — explicit labels (`aria-label`, `label[for]`,
    wrapping label, sibling label in the field container) beat placeholders, so
    Ashby's `placeholder="Type here..."` inputs stop producing bogus questions.
  - Ashby `_systemfield_*` id mapping in `classifyField` — name/email/resume/
    linkedin/github fields auto-answer from the profile.
  - Unlabeled file inputs are skipped (Ashby renders an auxiliary unlabeled file
    input next to the real Resume upload → phantom empty question).
  - Bot-cookie **false positive** removed: a stale `cf_clearance` (which proves a
    PREVIOUS successful Cloudflare pass) no longer blocks a clean page. Only a
    real challenge widget in the DOM or visible block text counts as a block;
    cookies only enrich the reason string when a real block is already detected.
    This unblocked Lever (`jobs.lever.co`) applications.
  - **2026-08-04 second batch (Workable + field-reliability):**
    - Workable URL normalization — the public feed emits description-only
      `/jobs/view/{id}` links (no form → 0 fields); the engine rewrites them to
      the real `/j/{id}/apply` form before extracting.
    - Workable option labels leak an inline-SVG noscript fallback ("SVGs not
      supported by this browser."); stripped in `extractFields`.
    - Same-`name` radio inputs (each option is its own input on Workable, Lever,
      Greenhouse) collapse into a single `radio-group` field with ≥2 visible
      options; single-option groups stay as standalone consent radios.
    - `clickRadioGroupOption()` — answers grouped radios by matching option
      text, force-checks with a native-setter fallback for overlay-covered
      radios (Workable); an unmatched option in a multi-radio group is left for
      the user, never force-checked.
    - Overlay-blocked text inputs: Playwright's 30s actionability click capped
      at 3s; on failure a JS native-setter + input/change events fill the field
      (this fixed Workable's sticky overlays stalling fills and blowing the
      bridge's fill timeout).
    - Classifier guards in `FIELD_CATEGORIES`/`classifyField`: name/first/last
      exclude referral/recruit/employee/"hiring manager"/contact; generic
      "years of experience" excludes skill-specific questions; `start date`
      excludes school/degree/education fields; phone country-code widgets
      excluded; `location` uses `\bcity\b` and `resume` uses `\bcv\b` so
      "authenticity"/"curriculum" substrings can't misfire.

## Stealth & anti-bot (2026-08-03)

- `apply-job.mjs` now picks the **most-stealth engine available**:
  1. **`patchright`** (preferred) — patched playwright-core that hides CDP
     leaks (`Runtime.enable`, console assertions, ...) — this is what actually
     gets headless Chromium past **Cloudflare**. Verified: `internshala.com` and
     `shine.com` both load a real page in headless mode, no challenge
     (`CF_BLOCKED: false`).
  2. **`playwright-extra` + `puppeteer-extra-plugin-stealth`** (fallback for
     `--stealth`) — JS-level stealth (`navigator.webdriver`, `chrome.runtime`),
     helps in-house bot checks but NOT Cloudflare.
  3. plain `playwright` — fine for company ATS pages with no bot wall.
- The engine used is logged to stderr as `[stealth] engine=patchright` so runs
  are diagnosable from bridge logs.
- **Important:** the runtime `package.json` must include `patchright`,
  `playwright-extra`, `puppeteer-extra-plugin-stealth` — the runtime
  `node_modules` previously shipped only `playwright`, so the `--stealth` flag
  the app always sends was silently no-oping on-device. Patchright's browser is
  the same chromium-1228 revision; CDP fixes live in the JS core.
- Browser resolution still honours `/opt/ms-playwright`
  (`PLAYWRIGHT_BROWSERS_PATH`), so no extra browser copy is needed.

## Portal login reality (2026-08-03)

- Company ATS career pages (Greenhouse, Ashby, Lever, Workable, ...) have no
  Cloudflare wall — `apply-job.mjs` extracts + auto-fills them cleanly with the
  per-user profile, attaching `output/current-resume.pdf` (the user's exact
  resume as provided — never regenerated). Only outreach email HTML carries the
  portfolio dark theme. This is the reliable path.
- **Cloudflare is now cleared** (patchright) on Internshala and Shine — the
  only remaining blocker is the **portal login**: Internshala bounces
  unauthenticated visitors to `/registration/student` (Google button visible,
  email/password fields hidden until that path is chosen). The seeded
  `google-cookies.json` is Google-only, and the encrypted `.portal-creds.json`
  vault is per-user (empty for `hsinghjayesh@gmail.com`), so the auto-login has
  nothing to use and headless Google OAuth consent cannot complete. Unblock:
  store the portal email + password in the vault (`POST /portal-creds`,
  AES-256-GCM at rest, per-user), and `loginWithPortalCreds()` will log in
  headlessly (no popup) before filling. Any app user can do this from
  Settings → Portal Logins.

## Related files

- `seed-cookies.mjs`
- `apply-job.mjs`
- `login-session.mjs`
- `smoke-pw.mjs`
- `scan.mjs`
- `package.json` (runtime deps: `patchright`, `playwright-extra`,
  `puppeteer-extra-plugin-stealth`)

## Links

- [[Portal Session]] — the login flow it powers
- [[Auto-fill Pipeline]] — the form-filling consumer
- [[Bridge Server]] — spawns these scripts per request
- [[Job Scanning]] — discovery use of Playwright
- [[CV & PDF Generation]] — produces the CV that gets attached
