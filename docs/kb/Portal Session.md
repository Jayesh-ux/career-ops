---
type: boundary
tags: [boundary, session, login, playwright]
updated: 2026-08-03
---

# Portal Session

The **single source of portal auth** for the whole system: one Google sign-in,
performed once inside a persistent Playwright browser profile, whose session
cookies are saved and reused by every future portal auto-fill.

## How the one-time login works

1. User opens the portal login screen in the [[Android App]] (onboarding step
   or Settings → Portal Logins).
2. The app calls `POST /login/session/open` on the [[Bridge Server]], which
   spawns `login-session.mjs --port <n> --email <userId>`.
3. `login-session.mjs` launches the user's **persistent profile** at
   `data/users/<email>/.pwprofile/` and serves a live HTTP control surface
   (screenshot + tap/type/navigate) on a private port.
4. `autoDrive()` watches Google's sign-in page and **pre-fills the email,
   clicks Continue, picks the account, and approves the OAuth consent** — the
   user only types the password (+2FA).
5. The app polls `/login/session/state` for `googleSignedIn` / `onGoogleAuth` /
   `hasGaps`, then on "Save session" calls `POST /login/session/finish`, which
   closes the browser and reports whether real auth cookies exist.

## Persisted-session check (no browser launch)

`GET /portal/session/status` reads the cookie DB directly (sqlite3) and reports
whether `SID` / `HSID` / `SAPISID` / `__Secure-1PSID` exist on `google.com`.
This is what gates the [[Onboarding Flow]] for existing users and the Settings
UI — no browser needs to spin up just to answer "am I connected?".

## State vocabulary

- `googleSignedIn` — real auth cookies present (green ✅)
- `hasGaps` — only `__Host-GAPS` (pre-auth, **not** signed in)
- `onGoogleAuth` — currently on `accounts.google.com`
- `formVisible` — an interactive form is on screen

## Related files

- `login-session.mjs`
- `bridge-server.mjs` (`/login/session/*`, `/portal/session/status`)
- `career-ops-app/.../PortalLoginScreen.kt`

## Links

- [[Google OAuth]] — why a browser session is required at all
- [[Playwright Automation]] — the engine
- [[Auto-fill Pipeline]] — the consumer of the saved session
- [[Bridge Server]] — HTTP surface
- [[Android App]] — live remote view UX
