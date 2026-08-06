---
type: tool
tags: [tool, email, imap]
updated: 2026-08-06
---

# IMAP Email

Inbox automation for the job search: reading recruiter replies, classifying
them, detecting interview invitations, drafting replies, and filtering spam.

## Recruiter-reply / interview detection (classifier-gated, 2026-08-06)

The inbox scan window was the root cause of invisible recruiter mail: the Gmail
REST fetch capped at 50 messages (≈2 days of inbox volume), so older outreach
(like Anisha Gupta's Swiggy thread) never reached the app. Fixes:

- `fetchGmailInboxREST` now **paginates via `nextPageToken`** up to a 250-message
  cap and fetches bodies in bounded chunks — wide windows actually return wide
  windows.
- `/email/inbox` accepts a **`query`** param (e.g. `from:flexiple.com`) passed
  straight to the Gmail API.
- Detection in `/notifications/check` and `/interview/detect` is **gated on the
  opencode classifier** (`/email/classify`): a message must come back
  `job_reply` with confidence ≥ 0.7, and must pass the shared `DIGEST_SENDERS`
  blocklist (job boards + digest/newsletter/no-reply senders), before it can
  surface as a recruiter reply, offer, or interview. This killed the fake
  "Interview Scheduled" entries (Quora/Indeed/Internshala digests, Edureka
  bootcamps) that used to pollute `interviews.json`. `interviews.json` was
  purged to `[]`.
- The Android app mirrors the gate: `startInboxPolling` cheap-filters with
  `looksLikeRecruiterReply`, then confirms via `classifyEmail` (`job_reply`,
  ≥ 0.6) before notifying. `DailyAutomationWorker` does the same and only
  notifies on confirmed job_reply.

## Endpoints (Bridge Server)

| Endpoint | Purpose |
|----------|---------|
| `/email/inbox` | List + classify inbox emails, detect interviews/replies |
| `/email/send` | Send an application/reply email (OAuth via the token store) |
| `/email/reply` | Draft a context-aware reply using career-ops data |
| `/email/spam/delete` | Detect and remove recruitment junk/spam |

## Auth model

Uses the **Gmail OAuth API token** captured during [[Onboarding Flow]] Google
sign-in and stored per-user by the [[Bridge Server]] (`getUserOAuth`). This is
a *different* credential family from the portal browser session — see
[[Google OAuth]] for the split.

## Rules

- Never auto-send: drafts are shown to the user, who confirms the send
  ([[Security & Human-in-the-loop]]).
- All mail operations go through the bridge API — never direct SMTP/nodemailer.

## Related files

- `bridge-server.mjs` (`/email/*`, `/notifications/check`, `/interview/detect`,
  `fetchGmailInboxREST`, `classifyEmailViaBridge`, `DIGEST_SENDERS`)
- `ChatViewModel.kt` (`startInboxPolling` classifier gate)
- `DailyAutomationWorker.kt` (classifier-gated draft notifications)
- `_check_inbox.mjs`, `_check_creds.mjs` (helpers)

## Links

- [[Google OAuth]] — the token it relies on
- [[Bridge Server]] — HTTP surface
- [[Application Tracker]] — replies update application status
- [[Security & Human-in-the-loop]] — send confirmation rule
