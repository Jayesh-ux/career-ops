---
type: boundary
tags: [boundary, oauth, google]
updated: 2026-08-03
---

# Google OAuth

The design's hardest boundary. Google issues **two unrelated kinds of
credentials**, and the architecture must respect the split:

| Kind | Purpose | Lives where | How obtained |
|------|---------|-------------|--------------|
| OAuth **API token** | Gmail/IMAP access | bridge user store (`getUserOAuth`) | Android Google sign-in consent |
| **Browser session** (cookies) | Web logins on portals | Playwright `.pwprofile` cookie DB | captured from the app's WebView login, seeded via `seed-cookies.mjs` |

## One login for both (current path)

The Android app runs a **WebView** (in `GoogleOAuthActivity`) to do the Google
sign-in. That single interaction mints **both** credential families:

1. `GoogleOAuthActivity` intercepts the redirect to `https://career-ops.app`,
   captures the OAuth `code`, and — after ~1 s — pulls the Google **session
   cookies** straight out of `CookieManager` (`SID`, `HSID`, `SAPISID`,
   `__Secure-1PSID`, `__Host-GAPS`, `NID`).
2. The auth code goes to the bridge → `getUserOAuth` → Gmail/IMAP
   ([[IMAP Email]]).
3. The cookies go to `POST /login/session/seed` → stored per-user as
   `google-cookies.json` ([[Multi-user Data Model]]).
4. Every Playwright spawn (`login-session.mjs`, `apply-job.mjs`) calls
   `seedGoogleCookies(context, userDir)` to inject those cookies into the
   persistent profile before any page loads.

So one WebView sign-in produces both the API token **and** the browser session.

## The rule

An IMAP refresh token **cannot** log you into job portals. When a portal says
"Login with Google" it starts a fresh OAuth flow in a browser; completing it
requires a real user interaction (password, 2FA, consent). There is no way to
convert the IMAP grant into browser cookies. This is a Google platform
constraint, not an implementation detail.

## Fallback: manual browser login

The `login-session.mjs` interactive path is still there for troubleshooting and
power users (the "Advanced / in-app browser" toggle in `PortalLoginScreen.kt`).
It launches the persistent profile, serves a live screenshot/tap/type surface,
and `autoDrive()` **pre-fills the email and auto-approves consent**, leaving
only the password/2FA to type. This is the *fallback*, not the primary path.

## False-success trap

An earlier bug: after clicking "Login with Google", the form-filler landed on
Google's own sign-in page and reported success after filling Google's email
field. The `isGoogleAuthPage()` guard now returns "no form" for
`accounts.google.com`, so an auth page is never mistaken for an application
form. See [[Auto-fill Pipeline]].

## Related files

- `career-ops-app/.../GoogleOAuthActivity.kt` (cookie capture after OAuth)
- `seed-cookies.mjs` (`seedGoogleCookies`, `stealthInitScript`)
- `login-session.mjs` (`autoDrive()` fallback)
- `apply-job.mjs` (`isGoogleAuthPage()`)
- `bridge-server.mjs` (`getUserOAuth` / `setUserOAuth`, `/login/session/seed`)

## Links

- [[IMAP Email]] — uses the API token
- [[Portal Session]] — uses the browser session
- [[Onboarding Flow]] — where both are minted
- [[Auto-fill Pipeline]] — consumes the browser session
