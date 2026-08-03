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
| **Browser session** (cookies) | Web logins on portals | Playwright `.pwprofile` cookie DB | one manual Google sign-in in a browser |

## The rule

An IMAP refresh token **cannot** log you into job portals. When a portal says
"Login with Google" it starts a fresh OAuth flow in a browser; completing it
requires a real user interaction (password, 2FA, consent). There is no way to
convert the IMAP grant into browser cookies. This is a Google platform
constraint, not an implementation detail.

## What the design does instead

The closest Google allows:

1. Gmail/IMAP → OAuth token from onboarding sign-in ([[IMAP Email]]).
2. Portals → **one-time** manual Google sign-in in the persistent browser
   profile, where `login-session.mjs` **auto-fills the email and auto-approves
   consent**, leaving only the password to type. Session cookies are saved once
   and reused by every portal auto-fill (see [[Portal Session]]).

## False-success trap

An earlier bug: after clicking "Login with Google", the form-filler landed on
Google's own sign-in page and reported success after filling Google's email
field. The `isGoogleAuthPage()` guard now returns "no form" for
`accounts.google.com`, so an auth page is never mistaken for an application
form. See [[Auto-fill Pipeline]].

## Related files

- `login-session.mjs` (`autoDrive()`)
- `apply-job.mjs` (`isGoogleAuthPage()`)
- `bridge-server.mjs` (`getUserOAuth` / `setUserOAuth`)

## Links

- [[IMAP Email]] — uses the API token
- [[Portal Session]] — uses the browser session
- [[Onboarding Flow]] — where both are minted
- [[Auto-fill Pipeline]] — consumes the browser session
