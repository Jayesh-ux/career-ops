---
type: component
tags: [component, android, compose]
updated: 2026-08-06
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

### Re-login gate on expired Gmail token (2026-08-06)

Before the portal check, `resolveStartDestination()` calls
`GET /users/{email}/oauth/status`. If the bridge reports the token as
`configured && isExpired && !hasRefreshToken` (access token dead and no refresh
token to recover it), the user is routed straight back to `ONBOARDING_GOOGLE`
instead of Chat — inbox/reply/email features would otherwise fail silently while
the user sits in Chat. Tokens with a usable refresh token are left alone: the
bridge refreshes them automatically. The Gmail OAuth URLs force
`prompt=consent%20select_account` so every sign-in re-mints a refresh token
(see [[Google OAuth]] refresh-token trap).

### Onboarding LinkedIn capture

`ONBOARDING_PROFILE` (`ProfileFormScreen`) collects the LinkedIn URL alongside
name/roles/location/salary and persists it to `profile.yml candidate.linkedin`
via `PUT /profile`. Combined with the `linkedin` fallback in [[Auto-fill Pipeline]]
`answerField` (form-answers.yml first, then profile), LinkedIn is asked exactly
once and never re-surfaced on application forms.

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

### Manual-apply fallback (2026-08-05)

If every automated method is exhausted, the app pushes an explicit **apply
manually** instruction instead of a dead end:

- `startAutoFill` now treats a `/apply/open` **error OR an empty `fields`
  list** (login-walled portal / SPA form that never rendered / multi-step
  apply) as "every method tried" and immediately shows a `ManualApplyCard` —
  with the bridge's `manual_apply_guide` (direct `manual_apply_url`, the
  fields to fill with required markers, and any notes) plus an **"I applied
  manually — update tracker to Applied"** button (`handleMarkApplied`).
- The `/apply/fill` failure path in `handleConfirmFill` (login wall on the
  fill step) also appends a `ManualApplyCard` instead of only a text message.
- `ManualApplyCard` renders the guide's field map so the user can complete the
  form in their browser with profile values pre-filled as hints. The manual
  apply prompt is only reachable from apply-intent (score ≥ 4.0 evaluation
  cards / batch "Apply" / scan-result apply), so "good fit" is implied by the
  flow itself.

Never auto-sends: the email is always shown for review first
([[Security & Human-in-the-loop]]).

## Related files

- `career-ops-app/app/src/main/java/com/careerops/app/ui/navigation/Navigation.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/MainActivity.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/GoogleOAuthActivity.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/ui/screens/settings/PortalLoginScreen.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/ui/onboarding/GoogleSignInScreen.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/ui/onboarding/UploadResumeScreen.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/data/remote/CareerOpsApi.kt`
- Build → `./gradlew :app:assembleDebug` → deploy to `/sdcard/Download`

## Links

- [[Onboarding Flow]] — the start destination chain
- [[Bridge Server]] — every API call target
- [[Portal Session]] — the live login screen it renders
- [[Google OAuth]] — Gmail sign-in on device
- [[Security & Human-in-the-loop]] — never auto-submits
