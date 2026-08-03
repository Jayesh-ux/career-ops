---
type: component
tags: [component, android, compose]
updated: 2026-08-03
---

# Android App

A Jetpack Compose app under `career-ops-app/` that turns the CLI tool into a
phone experience. It is a **thin client**: it calls the [[Bridge Server]] and
renders results; almost no logic lives on-device.

## Navigation graph

The whole app is one `NavHost` (`Navigation.kt`) keyed off the
[[Onboarding Flow]]:

- `ONBOARDING_GOOGLE` → Google sign-in (Gmail OAuth)
- `ONBOARDING_RESUME` → upload resume
- `ONBOARDING_PROFILE` → profile form
- `ONBOARDING_PORTAL` → "Connect your job portals" ([[Portal Session]])
- `ONBOARDING_CONFIRM` → done
- `CHAT` / `DASHBOARD` / `APPLICATIONS` / `SETTINGS` → post-onboarding
- `PORTAL_LOGIN` → the same portal login screen reachable from Settings

## Key routing rule

For existing users (name already on the bridge profile), onboarding is skipped.
`nextRouteAfterAuth` decides where a signed-in user lands: straight to `CHAT`,
**or** through the skipable portal step when `GET /portal/session/status`
reports `googleSession == false`. The check **fails open** — if the bridge is
down it goes to `CHAT` rather than blocking.

## Related files

- `career-ops-app/app/src/main/java/com/careerops/app/ui/navigation/Navigation.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/ui/screens/settings/PortalLoginScreen.kt`
- `career-ops-app/app/src/main/java/com/careerops/app/data/remote/CareerOpsApi.kt`
- Build → `./gradlew :app:assembleDebug` → deploy to `/sdcard/Download`

## Links

- [[Onboarding Flow]] — the start destination chain
- [[Bridge Server]] — every API call target
- [[Portal Session]] — the live login screen it renders
- [[Google OAuth]] — Gmail sign-in on device
- [[Security & Human-in-the-loop]] — never auto-submits
