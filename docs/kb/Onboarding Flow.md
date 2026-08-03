---
type: flow
tags: [flow, onboarding, ux]
updated: 2026-08-03
---

# Onboarding Flow

The first-run journey that turns "signed in" into "ready to apply". This is the
flow the [[Android App]] starts on, and where the one-time portal login lives.

## The chain

```
Google sign-in → Upload resume → Profile form → Portal login → Confirm → Chat
```

1. **Google sign-in** — Gmail OAuth via the Android identity system; the bridge
   stores the token for [[IMAP Email]]. See [[Google OAuth]].
2. **Upload resume** — pushes the CV to the per-user `data/cv.md`.
3. **Profile form** — writes `config/profile.yml`.
4. **Portal login** — "Connect your job portals": one Google sign-in inside a
   live Playwright view ([[Portal Session]]), skipable.
5. **Confirm** — "you're all set".
6. **Chat** — the main screen.

## Existing users skip (mostly)

If the bridge already has a profile (name filled) or the local `isOnboarded`
flag is set, onboarding is **not** re-run. Instead `nextRouteAfterAuth` shows
only the portal step — and only while no Google portal session is saved:

- `GET /portal/session/status` → `googleSession: true` → straight to `CHAT`
- `googleSession: false` → `ONBOARDING_PORTAL` (skipable) → `CHAT`
- status check fails → `CHAT` (fail-open, never blocks)

This is how existing users like `hsinghjayesh@gmail.com` get the portal step
"after every sign-in until done".

## Related files

- `career-ops-app/.../ui/navigation/Navigation.kt`
- `career-ops-app/.../ui/screens/settings/PortalLoginScreen.kt`

## Links

- [[Android App]] — the host
- [[Bridge Server]] — `portal/session/status` gate
- [[Portal Session]] — the step itself
- [[Google OAuth]] — Gmail vs portal credential split
- [[Multi-user Data Model]] — profile-per-user
