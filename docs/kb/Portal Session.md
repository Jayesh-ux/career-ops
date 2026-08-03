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

1. User taps "Sign in with Google" on the portal login screen in the
   [[Android App]] (onboarding step or Settings → Portal Logins). Both entry
   points run the **same WebView OAuth** as the Gmail sign-in.
2. `GoogleOAuthActivity` intercepts the redirect to `https://career-ops.app`,
   captures the OAuth `code` **and** the Google session cookies from the
   WebView's `CookieManager` (see [[Google OAuth]]).
3. The cookies are sent to `POST /login/session/seed`, which stores them
   per-user at `<userDir>/google-cookies.json` (`seed-cookies.mjs`). The app
   defers this POST until the OAuth exchange has resolved the user's email, so
   the request carries the correct `X-User-Id` — the bridge rejects a seed
   without it.
4. Every later Playwright spawn (`login-session.mjs`, `apply-job.mjs`) calls
   `seedGoogleCookies(context, userDir)` to inject those cookies into the
   persistent profile at `data/users/<email>/.pwprofile/` before loading any
   page — so portals are already signed in, no password needed.

If the cookie path fails, the user can fall back to the **Advanced** "in-app
browser" (`login-session.mjs` live screenshot/tap/type surface with
`autoDrive()`), which completes a manual sign-in in the persistent profile.

## Persisted-session check (no browser launch)

`GET /portal/session/status` reports whether the user is connected by checking
**two sources**, with no browser needing to spin up:

- the seeded `<userDir>/google-cookies.json` (the WebView/one-login path), and
- the Playwright cookie DB (`.pwprofile/Default/Cookies`, read via sqlite3).

It returns `googleSession: true` if `SID` / `HSID` / `SAPISID` /
`__Secure-1PSID` appear in either source, and `via` = `'oauth-seed'` (WebView
seed), `'profile'` (Playwright profile), or `'none'`. This gates the
[[Onboarding Flow]] for existing users and the Settings UI.

## State vocabulary

- `googleSignedIn` — real auth cookies present (green ✅)
- `hasGaps` — only `__Host-GAPS` (pre-auth, **not** signed in)
- `onGoogleAuth` — currently on `accounts.google.com`
- `formVisible` — an interactive form is on screen

## Related files

- `seed-cookies.mjs` (`seedGoogleCookies`, `loadGoogleCookies`)
- `login-session.mjs` (advanced/fallback manual login)
- `bridge-server.mjs` (`/login/session/seed`, `/portal/session/status`)
- `career-ops-app/.../PortalLoginScreen.kt`
- `career-ops-app/.../GoogleOAuthActivity.kt`

## Links

- [[Google OAuth]] — why a browser session is required at all
- [[Playwright Automation]] — the engine
- [[Auto-fill Pipeline]] — the consumer of the saved session
- [[Bridge Server]] — HTTP surface
- [[Android App]] — live remote view UX
