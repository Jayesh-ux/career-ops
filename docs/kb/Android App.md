---
type: component
tags: [component, android, compose]
updated: 2026-08-11
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

In `ChatViewModel.sendMessage` intent routing, the **spam branch wins over the
inbox branch** (2026-08-11): `contains("spam")`/`"clean inbox"`/`"delete spam"`
is checked before the "inbox" keywords. The "Clean spam" quick action sends
"clean spam" (it used to send "clean spam from my inbox", whose "inbox" keyword
routed to the recruiter-reply scan — clean spam then "checked for recruiter
reply" and did nothing).

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
   `POST /email/send` (per-user OAuth, per-user CV attached) →
   `markCompanyApplied()` (tracker set to `Applied`, notes `Emailed {to} via
   career-ops app` + `contactEmail`).
   The draft card carries `sending`/`sent` state: while `POST /email/send` is
   in flight the Send button shows a spinner and is disabled ("Sending…"), then
   flips to a disabled "Sent" state. `sendEmail()` also guards against repeat
   taps in the ViewModel (`sendingDraftIds`/`sentDraftIds`), so one confirmation
   can never fire multiple sends; `ReplyDraft` has the same guard. The bridge's
   `/email/send` additionally idempotency-blocks identical sends within 60s.
4. **No email on the posting page** → the drafter agent websearches for the
   company's real application/HR email (e.g. "<company> careers email" or the
   company site's contact page) before giving up. What happens next depends on
   what the draft response contains:
   - **Recruiter phone present** → a `WhatsAppApply` card (see below) — no
     auto-fill attempt, WhatsApp is the fastest channel and the posting had no
     email anyway.
   - **No phone, job URL present** → Playwright auto-fill
     (`startAutoFill` / `/apply/open` + `/apply/fill`).
   - **Neither** → a manual-apply message.

### WhatsApp fallback (2026-08-08)

When `/email/draft` returns a recruiter `phone` but no contact email, the app
pushes a **`WhatsAppApply`** card instead of the doomed auto-fill path:

- `ChatViewModel.draftApplication()` (the `to.isBlank()` + `phone` branch)
  renders the drafted letter as a WhatsApp message.
- **Multi-phone support (2026-08-09):** a posting can expose several recruiter
  phones (comma/semicolon/newline separated). `splitPhones()` splits them and
  each number becomes its own `ChatMessage.WhatsAppTarget` (label + E.164
  digits + its own wa.me link) — numbers are never concatenated into one
  invalid link. `normalizeWhatsAppNumber()` strips non-digits, drops a leading
  `0` from 11-digit locals, prepends `91` to bare 10-digit mobiles, and
  rejects anything outside 10–15 digits. `WhatsAppApplyCard` renders one
  "Send to {number}" button per target; the drafted letter is pre-typed into
  whichever the user taps. WhatsApp itself is the registration detector (a
  number without WhatsApp shows WhatsApp's error instead of a chat) — reliable
  automatic detection needs a paid/signup check API, so it's intentionally not
  attempted.
- `buildWhatsAppLink()` normalizes the number (strips non-digits, prepends the
  `91` country code for bare 10-digit mobiles — wa.me needs the international
  number) and URL-encodes the message into `https://wa.me/{number}?text=...`.
- `WhatsAppApplyCard` (ChatScreen) shows phone + role + job URL + a truncated
  preview of the letter, and two buttons: **"Open WhatsApp with my
  application"** (`Intent(ACTION_VIEW)` on the wa.me link — opens WhatsApp with
  the message prefilled, one tap to send) and **"I sent it — update tracker to
  Applied"** (reuses `handleMarkApplied` → `markCompanyApplied`).
- This makes the no-email case self-contained on-device: the user can apply
  without the assistant present (no copy/paste, no manual compose).

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

### Unified tracker update (2026-08-06)

Every apply-completion path funnels through `ChatViewModel.markCompanyApplied()`:

- **Email send** (`sendEmail` success), **auto-fill submit**
  (`handleSubmitApplication` success), and **manual apply**
  (`handleMarkApplied`) all call it.
- It finds the company's existing tracker row (case-insensitive) and sets it
  to **Applied**; if no row exists it **adds a new one** as Applied (role
  threaded through the auto-fill flow via `_pendingAutoFillRole`). This kills
  two bugs at once: no more duplicate rows when a job was already tracked as
  Evaluated, and no more "no tracker entry found" dead-ends when the job was
  never tracked. Scan/dedup (`isSpammed`) then correctly skips it next time.

Never auto-sends: the email is always shown for review first
([[Security & Human-in-the-loop]]).

## Chat inbox flow (2026-08-07)

"check inbox" now routes to **`POST /email/scan`** (the classified, cursor-based
scan) instead of the raw unclassified `/email/inbox`:
- `ChatViewModel.handleDirectInbox` keeps only `interview` / `offer` /
  `recruiter_reply` notifications and renders one `InboxNotificationCard` per
  message (type, title, body, from/from-email, subject, date).
- Each card's **Reply** button calls `draftReplyForThread(to, subject,
  originalBody, inReplyTo, threadId, replyType)` which POSTs to the bridge's
  thread-aware `/email/reply` and renders a `ReplyDraft` card carrying the full
  chain (`inReplyTo`, `threadId`). Sending goes through `/email/reply/send` with
  `In-Reply-To`/`References` headers so the reply lands in the original thread.
- `handleDirectReply` resolves a free-text hint (e.g. "reply to anisha") against
  the last `InboxNotificationCard`s; if no conversation matches it says so
  instead of failing.
- `handleDirectInbox` (2026-08-11) posts `daysBack: 90`, so a manual "check
  inbox" re-lists EVERY recruiter reply from the last 90 days via the bridge's
  fast full-listing pipeline (metadata cache + heuristic pre-filter — see
  [[Bridge Server]]). The background poll keeps scanning incrementally (new
  only), so no old recruiter conversation is ever missed. On failure the card
  now appends the real exception reason in parentheses so a recurring "check
  inbox" error can be diagnosed from the chat instead of the generic message.
- **`Map<String, Any>` @Body bug (2026-08-11)**: Retrofit rejects Kotlin
  `Map<String, Any>` request bodies — the compiler emits `Map<String, ?>` (a
  wildcard), and Retrofit throws
  `Parameter type must not include a type variable or wildcard` at call time,
  **before the request reaches the network** (so the server log stays silent).
  This was the root cause of the "Couldn't check your inbox" failure. Every such
  endpoint in `CareerOpsApi` now uses a concrete request class
  (`ScanInboxRequest`, `SpamDeleteRequest`, `FormAnswersRequest`,
  `LoginSessionTapRequest`, `SeedLoginSessionRequest`). `Map<String, String>`
  bodies and `Map<String, Any>` *return* types are unaffected.
- `handleDirectSpam` (HITL: never deletes without a confirm card) lists
  `/email/inbox?includeSpam=true`. The bridge nests spam detection under
  `email.spam:{isSpam,spamScore,signals}` — not a flat `isSpam` — so `InboxEmail`
  carries `spam: SpamInfo?` and the filter checks `it.spam?.isSpam == true`
  (2026-08-11; the flat field was never populated, so "clean spam" always
  reported "No spam emails found to delete").

## Pinned suggested jobs (2026-08-07, realtime 2026-08-08)

Every scan's results are collected into `ChatViewModel.suggestedJobs`
(deduped). A pinned **ExtendedFloatingActionButton** ("Suggested (N)") opens a
modal (`Dialog`) listing them with **Apply** (runs `draftApplication`) and
**Open** (opens the posting in the system browser) buttons. Applying to a
company removes it from the list, so it only ever shows unapplied
opportunities. `removeAppliedFromSuggested(company, jobUrl)` (2026-08-07) now
drops the exact applied job **by URL** in addition to by company, and
`markCompanyApplied` threads the job URL through from every apply path that has
it (auto-fill submit, manual-apply card) so the applied posting disappears even
if its recorded company name differs from the listing's. `JobCardBubble` and
`ScanResultRow` also gained an **Open**
button (`OpenJobUrlButton` helper). The list is **persisted to disk**
(`UserPrefs.saveSuggestedJobs` → `suggested_jobs.json`) and restored in the
ViewModel `init`, so the pinned button survives app restarts — including being
killed from Recents. It is written immediately at scan completion (in
`handleDirectScan`, so a quick app-kill right after a scan can't lose the
results) and also auto-persisted via a `snapshotFlow` (500ms debounce) on
`suggestedJobs`.
**Server-cached restore (2026-08-11)**: the bridge caches the last scan's job
list per-user (`GET /scan/results`, backed by `scan-results-cache.json`).
`restoreSuggestedJobsFromServer()` runs in `init` and replaces the pinned list
with that server cache when present — instant restore on open, and the list
only changes when the user runs a scan again (which overwrites the server
cache). The local `suggested_jobs.json` restore stays as the offline fallback.
**Last-scan replace (2026-08-11)**: the pinned list now **replaces** (not merges)
on a scan's `done` event, so "View Jobs (N)" always equals the latest scan's
findings — FAB, JobsScreen header, the "Found N job(s)" chat message and the
card summary all show the same number (previously the list accumulated across
sessions/rounds, e.g. "View Jobs (840)" vs "510 found"). The server also refuses
to overwrite a good cache with an empty result set (portal-outage protection).

**Realtime (2026-08-08)**:
- **Live `results` SSE events** — `handleDirectScan` now handles the server's
  new `results` event and merges each snapshot into `suggestedJobs` as it
  arrives, so the FAB count and an already-open modal update live during the
  scan, not just at `done`.
- **Discard removes from the list** — `discardFromScanResults` and the batch
  evaluation card's discard action call `removeAppliedFromSuggested`, so a
  discarded job disappears immediately.
- **Tracker re-filter** — `filterSuggestedAgainstTracker()` drops any suggested
  job whose company is in the tracker with an active status
  (Applied/Interview/Offer/Responded/**Discarded**). It runs at `init`
  (cleans stale restored entries), again after each scan's `done` merge, **and
  now also on every inbox-poll cycle (30s)** so a company marked applied from
  another client (CLI, Playwright on the phone) vanishes from the pinned list
  within half a minute — not just on the next scan.
  `isSpammed` now also treats **Discarded** as blocking, so you can't
  re-apply to a company you discarded.
- **Auto-open** — when a scan completes with results, `openSuggestedJobs()`
  opens the pinned modal so the user never has to scroll the whole chat to find
  the list. **Removed (2026-08-08)**: the modal no longer auto-opens after a
  scan — it was popping over the scan summary the user was trying to read. The
  pinned FAB stays, so the full list is one tap away.
- **Always visible (2026-08-08)** — the pinned access never goes away:
  - `ChatViewModel.hasScannedOnce` is set when the first scan produces results
    (both the live `results` SSE merge and the final `done` merge) and when a
    non-empty list is restored on `init`. Once set, the pinned FAB renders
    **even when the list is empty**, so the button can't vanish into the chat
    history after you apply to everything.
  - The FAB is labeled **"View Jobs (N)"** (renamed from "Suggested"), and a
    matching **"View Jobs (N)" chip is placed FIRST in the always-visible bottom
    quick-actions row** (so it is on screen without horizontal scroll) — two
    permanent, zero-scroll access points.
- **Full-screen live JobsScreen (2026-08-08)** — the old small Dialog was
  replaced with a proper full-screen **`JobsScreen`** (`ui/chat/JobsScreen.kt`)
  that renders straight from the `suggestedJobs` state: search box + score
  filter chips (Top 4.0+/Good 3.0+/All), Apply/Discard/Open on every row, an
  empty state, and a live job counter. Because it binds to the State, applying
  or discarding a company removes it **in real time while the screen is open**.
  Both the pinned FAB/chip **and** every scan's chat "View all" button
  (`onViewAll = openSuggestedJobs()`) open this same screen — the scan-results
  snapshot path (`openScanResults`) is no longer used by the chat card, so the
  list can never go stale or be lost in chat history.
- **Live removal hardened (2026-08-08)** — `removeAppliedFromSuggested` and
  `filterSuggestedAgainstTracker` now match companies with `normalizeCompanyName`
  (lowercase, alphanumerics only) and match URLs ignoring a trailing slash, so
  an applied company is removed even if the tracked name/URL differs from the
  listing's (e.g. "Sanket Rathod Collectives" vs "Sanket Rathod Collectives Pvt
  Ltd"). `openScanResults` filters its snapshot against `suggestedJobs`, so the
  full-screen scan-results list never resurrects an applied/discarded job when
  re-opened from an old chat card.
- **Role-aware dedup (2026-08-08)** — applying to one role no longer hides a
  company's other openings. The dedup identity is now the **exact opening**:
  `isSameListing` matches by URL OR (normalized company AND normalized role),
  so "Senior Developer" at a company is removed while its "DevOps Engineer"
  listing stays visible and applyable. The same applies to
  `removeAppliedFromSuggested` (now takes `role`), `filterSuggestedAgainstTracker`
  (blocks `(company, role)` pairs, not companies), `isSpammed` (blocks only the
  same company+role), and `markCompanyApplied`/`findTrackerId` (role-aware: a
  different role at the same company gets its own truthful tracker row instead
  of overwriting another role's row).
- **Profile-driven scan chip** — the quick-action SCAN prompt was
  "scan for full stack developer jobs" (a hardcoded role that lied about what
  the scan does). It is now just `"scan"`: the scan iterates the user's OWN
  profile roles, so the processing card shows the real roles being searched and
  the same chip works for any user.

## Scan stop is reliable (2026-08-07)

The SSE scan read loop blocks on `readLine()`; a bare coroutine cancel can't
interrupt it. `handleDirectScan` now holds `activeScanCall` (an OkHttp call)
and `stopProcessing` calls `activeScanCall.cancel()` so the read unblocks. A
cancelled read throws `IOException`, which the generic catch now swallows when
`wasInterrupted` is set (the "Stopped" message was already posted). The
`handleConfirmFill` early-returns also clear the processing card, fixing the
stuck "processing" spinner.

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
