---
type: tool
tags: [tool, email, imap]
updated: 2026-08-03
---

# IMAP Email

Inbox automation for the job search: reading recruiter replies, classifying
them, detecting interview invitations, drafting replies, and filtering spam.

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

- `bridge-server.mjs` (`/email/*`)
- `_check_inbox.mjs`, `_check_creds.mjs` (helpers)

## Links

- [[Google OAuth]] — the token it relies on
- [[Bridge Server]] — HTTP surface
- [[Application Tracker]] — replies update application status
- [[Security & Human-in-the-loop]] — send confirmation rule
