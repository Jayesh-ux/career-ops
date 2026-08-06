---
type: boundary
tags: [boundary, oauth, google]
updated: 2026-08-06
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
   captures the OAuth `code`, and then **polls** `CookieManager` for up to
   ~6 s (400 ms × 15 attempts) to pull the Google **session cookies** — some
   flows (2FA, One Tap) commit cookies a moment *after* the code redirect, so a
   single-shot grab can miss them. It probes several hosts
   (`accounts.google.com`, `google.com`, `www.google.com`) and merges by name,
   because host-only cookies like `__Secure-1PSID` are invisible from other
   Google hosts (`SID`, `HSID`, `SAPISID`, `__Secure-1PSID`, `__Host-GAPS`,
   `NID`). The captured count + cookie names are returned in the activity
   result (`google_cookies_count`, `google_cookies_names`) so the UI can show
   exactly what the browser minted (see [[Portal Session]] diagnostics).
2. The auth code goes to the bridge → `getUserOAuth` → Gmail/IMAP
   ([[IMAP Email]]). The **cookies ride on the same exchange request** body
   (`cookies` field on `OAuthExchangeRequest`); the exchange handler writes
   them per-user as `google-cookies.json` (`[seed] via-exchange` log). This is
   the reliable path — a separate client-side seed POST proved flaky on the app
   side (see [[Portal Session]]), so the exchange is the source of truth.
3. `POST /login/session/seed` remains as a fallback/belt-and-suspenders store.
4. Every Playwright spawn (`login-session.mjs`, `apply-job.mjs`) calls
   `seedGoogleCookies(context, userDir)` to inject those cookies into the
   persistent profile before any page loads.

So one WebView sign-in produces both the API token **and** the browser session.

## Refresh-token trap (fixed 2026-08-06)

Google only mints a **refresh token on the first consent** for an app. A repeat
sign-in with `prompt=select_account` returns just a 1-hour access token — which
is exactly what happened: a re-login on 2026-08-06 stored `hasRefreshToken:
false`, the access token expired an hour later, and every inbox/send/reply
endpoint failed with "No email auth configured" even though the user was
"logged in". Fix: both OAuth auth URLs
(`GoogleSignInScreen.kt` and `PortalLoginScreen.kt`) now use
`prompt=consent%20select_account`, which forces the consent screen on **every**
sign-in and re-issues a refresh token. A stored credential is only usable when
`hasUsableOAuth` sees a `refreshToken` (or an unexpired access token).

## Scope requirements (spam-delete 403 fix 2026-08-06)

`POST /email/spam/delete` deletes Gmail messages via the Gmail REST API, which
requires the **`https://www.googleapis.com/auth/gmail.modify`** scope — the
`gmail.send` + `gmail.readonly` pair is not enough and returns
`403 Request had insufficient authentication scopes`. Both OAuth auth URLs
(`GoogleSignInScreen.kt` and `PortalLoginScreen.kt`) therefore request
`gmail.send gmail.readonly gmail.modify`. **A user who logged in before this fix
must re-login** (the consent screen re-issues the token with the wider scope)
before spam-delete succeeds.

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
