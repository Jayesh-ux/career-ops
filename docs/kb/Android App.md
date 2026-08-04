---
type: component
tags: [component, android, compose]
updated: 2026-08-04
---

# Android App

A Jetpack Compose app under `career-ops-app/` that turns the CLI tool into a
phone experience. It is a **thin client**: it calls the [[Bridge Server]] and
renders results; almost no logic lives on-device.

## Navigation graph

The whole app is one `NavHost` (`Navigation.kt`) keyed off the
[[Onboarding Flow]]:

- `ONBOARDING_GOOGLE` → Google sign-in (**one** WebView login via
  `GoogleOAuthActivity`; mints the IMAP token + captures portal cookies)
- `ONBOARDING_RESUME` → upload resume
- `ONBOARDING_PROFILE` → profile form
- `ONBOARDING_PORTAL` → "Connect your job portals" ([[Portal Session]])
- `ONBOARDING_CONFIRM` → done (gated on the portal session)
- `CHAT` / `DASHBOARD` / `APPLICATIONS` / `SETTINGS` → post-onboarding
- `PORTAL_LOGIN` → the same portal login screen reachable from Settings

## Key routing rule

For existing users (name already on the bridge profile), onboarding is skipped.
`nextRouteAfterAuth` decides where a signed-in user lands: straight to `CHAT`,
**or** through the (non-skipable) portal step when `GET /portal/session/status`
reports `googleSession == false`. The check **fails closed** — if the bridge is
down it routes to `ONBOARDING_PORTAL` rather than straight to Chat.

`MainActivity.resolveStartDestination()` repeats the portal-session check on
every cold start (splash + retry while it resolves) and cache-busts the saved
start destination, so reopening from Recents never silently skips an un-resolved
portal dependency.

## Apply routing (email-first)

`ChatViewModel.draftApplication()` is the single Apply entry point from job
cards and scan results. It runs:

1. **Dedup gate** — `getTracker()` + `isSpammed()`: skip if the company already
   has a tracker row in Applied/Interview/Offer/Responded.
2. **Email draft first (proven CLI path)** — always calls `POST /email/draft`
   with the job URL. The bridge's `fetchJdAndContact` scrapes the posting page
   for a real application email (many Indian portals like Naukri/Internshala/
   Shine/foundit expose one). This is the proven email-first strategy from the
   CLI (the 81-application run was mostly email applications).
3. **Email found** → `EmailDraft` card → user confirms → `sendEmail()` →
   `POST /email/send` (per-user OAuth, per-user CV attached) → tracker row
   `Applied` with notes `Emailed {to} via career-ops app` + `contactEmail`.
   The draft card carries `sending`/`sent` state: while `POST /email/send` is
   in flight the Send button shows a spinner and is disabled ("Sending…"), then
   flips to a disabled "Sent" state. `sendEmail()` also guards against repeat
   taps in the ViewModel (`sendingDraftIds`/`sentDraftIds`), so one confirmation
   can never fire multiple sends; `ReplyDraft` has the same guard. The bridge's
   `/email/send` additionally idempotency-blocks identical sends within 60s.
4. **No email on the posting page** → the drafter agent websearches for the
   company's real application/HR email (e.g. "<company> careers email" or the
   company site's contact page) before giving up; only if still nothing does it
   fall back to Playwright auto-fill (`startAutoFill` / `/apply/open` +
   `/apply/fill`) or a manual-apply message.

Never auto-sends: the email is always shown for review first
([[Security & Human-in-the-loop]]).

## Related files

- `career-ops-app/app/src/main/java/com/careerops/app/ui/navigation/Navigation.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/MainActivity.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/GoogleOAuthActivity.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/ui/screens/settings/PortalLoginScreen.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/ui/onboarding/GoogleSignInScreen.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/data/remote/CareerOpsApi.kt`
- Build → `./gradlew :app:assembleDebug` → deploy to `/sdcard/Download`

## Links

- [[Onboarding Flow]] — the start destination chain
- [[Bridge Server]] — every API call target
- [[Portal Session]] — the live login screen it renders
- [[Google OAuth]] — Gmail sign-in on device
- [[Security & Human-in-the-loop]] — never auto-submits
