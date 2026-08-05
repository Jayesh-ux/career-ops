---
type: flow
tags: [flow, onboarding, ux]
updated: 2026-08-05
---

# Onboarding Flow

The first-run journey that turns "signed in" into "ready to apply". This is the
flow the [[Android App]] starts on, and where the one-time portal login lives.

## The chain

```
Google sign-in → Upload resume → Profile form → Portal login → Confirm → Chat
```

1. **Google sign-in** — **one** WebView login (`GoogleOAuthActivity`) that
   mints both the Gmail/IMAP token and the portal browser session. See
   [[Google OAuth]].
2. **Upload resume** — pushes the CV to the per-user `data/cv.md` via
   `UploadResumeScreen.kt` (2026-08-05: picker now accepts any file type, the
   real MIME type is sent instead of a hardcoded `application/pdf`, and server
   errors surface verbatim — a scanned/image-only PDF now tells the user to
   upload a text-based PDF/DOCX instead of failing generically).
3. **Profile form** — writes `config/profile.yml`.
4. **Portal login** — "Connect your job portals": the same WebView Google login
   again (or reuse the session already captured at step 1 — the screen shows a
   green "Portals connected!" card and a single Continue). **Not skipable** in
   onboarding: Chat opens only when this is resolved.
5. **Confirm** — "you're all set" (gated on the portal session).
6. **Chat** — the main screen.

## Existing users skip (mostly)

If the bridge already has a profile (name filled) or the local `isOnboarded`
flag is set, onboarding is **not** re-run. Instead `nextRouteAfterAuth`
(`Navigation.kt`) shows only the portal step — and only while no Google portal
session is saved:

- `GET /portal/session/status` → `googleSession: true` → straight to `CHAT`
- `googleSession: false` → `ONBOARDING_PORTAL?next=CHAT`
- status check fails / bridge down → **`ONBOARDING_PORTAL`** (fail-**closed**,
  never straight to Chat)

`MainActivity.resolveStartDestination()` runs the same check on cold start
(reopening from Recents included), showing a splash while it resolves. This is
how existing users like `hsinghjayesh@gmail.com` get the portal step "after
every sign-in until done". After a fresh sign-in the check retries briefly
(~3 s) so the cookie seed lands before routing — the user signs in once.

## Related files

- `career-ops-app/.../ui/navigation/Navigation.kt`
- `career-ops-app/.../ui/onboarding/UploadResumeScreen.kt`
- `career-ops-app/.../MainActivity.kt` (cold-start resolve)
- `career-ops-app/.../ui/screens/settings/PortalLoginScreen.kt`
- `career-ops-app/.../GoogleOAuthActivity.kt`

## Links

- [[Android App]] — the host
- [[Bridge Server]] — `portal/session/status` gate
- [[Portal Session]] — the step itself
- [[Google OAuth]] — Gmail vs portal credential split
- [[Multi-user Data Model]] — profile-per-user
