---
type: tool
tags: [tool, email, imap]
updated: 2026-08-07
---

# IMAP Email

Inbox automation for the job search: reading recruiter replies, classifying
them, detecting interview invitations, drafting replies, and filtering spam.

## Recruiter-reply / interview detection (classifier-gated, 2026-08-06)

The inbox scan window was the root cause of invisible recruiter mail: the Gmail
REST fetch capped at 50 messages (≈2 days of inbox volume), so older outreach
(like Anisha Gupta's Swiggy thread) never reached the app. Fixes:

- `fetchGmailInboxREST` now **paginates via `nextPageToken`** up to a 5000-message
  cap and fetches bodies in bounded chunks with 3-attempt retry (a 250-message cap
  still truncated the 90-day backfill — this mailbox had **2035 messages** in 90
  days). Any message that still fails to fetch is returned in `failedIds` and
  retried by id on the next scan instead of being silently dropped.
- `/email/inbox` accepts a **`query`** param (e.g. `from:flexiple.com`) passed
  straight to the Gmail API, and an **`ids`** param to fetch specific messages by
  id (independent of the time window — used to retry failed messages).
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

## Cursor-based scan — no opportunity ever missed (2026-08-07)

`POST /email/scan` (backed by `scanInboxForUser`) is the app/daily-worker scan
path. It is **per-user cursor-based**, with per-user state files under
`data/users/<email>/data/`:

- `inbox-cursor.json` — `{ lastScanAt, lastGmailIdSeen, processedIds, pendingIds }`
- `email-classify-cache.json` — classification cache (exactly-once classification)
- `pending-notifications.json` — durable notification queue (see below)

Flow:

1. **First run (no cursor) or `forceBackfill`** → one-time 90-day deep backfill
   enumerating up to **5000 messages** (not 250 — heavy mailboxes would otherwise
   truncate older recruiter outreach).
2. **Later runs** → incremental window = last scan + 2-day overlap, skipping
   `processedIds` and reusing the classify cache, so every email is classified
   **exactly once**.
3. **Nothing is ever lost**: messages that fail to fetch or classify go into
   `pendingIds` and are re-fetched **by id** on every scan (independent of the
   now-moving time window) until they are processed.
4. **Resumable**: progress (`processed`, `pending`, cache) is persisted every 50
   classifications. An interrupted backfill (server restart, client timeout)
   resumes from the snapshot instead of restarting from scratch. `lastScanAt` is
   advanced **only on a completed scan**, so a partial backfill re-runs the full
   window rather than shrinking it.
5. **Durable notifications**: each recruiter-reply / offer / interview
   notification is queued to `pending-notifications.json` as it is found. The
   next `/email/scan` or `/notifications/check` replays the queue once and clears
   it only after the response is actually written to the client — so a lost
   backfill response (long-running request, client timeout) never loses the
   opportunity.

The app-side consumer is `DailyAutomationWorker` (calls `api.scanInbox`, notifies
on `recruiter_reply`/`interview`/`offer`).

## Salary gate — unpaid/free work is never an opportunity (2026-08-07)

The candidate's onboarding profile (`config/profile.yml`) declares
`compensation.minimum` (3 LPA) and `target_range` (3-12 LPA). Two layers enforce
it so a "free internship" can never surface as a recruiter reply, offer, or
interview:

1. **Classifier gate (primary, spawned opencode)** — `POST /email/classify`
   injects the candidate's compensation expectation into the prompt and mandates
   that emails offering an **unpaid/free internship, stipend-less/volunteer
   arrangement, or compensation below the minimum** classify as `spam`, never
   `job_reply`. `classifyEmailViaBridge` now sends up to 2000 chars of body text
   (previously only a 500-char preview) so the unpaid signal is actually visible.
2. **Cheap sync gates (belt-and-suspenders)** — inside `scanInboxForUser`'s
   `handleEmail`, two checks run *before* classification (so they also apply to
   already-cached verdicts):
   - `isBelowCompensationEmail` — regex hit on `unpaid` / `free intern` /
     `no stipend` / `not paid` / `no salary` etc. (guarded against
     "not unpaid"/"paid internship" framings) → skip, don't notify.
   - `isBlacklistedSender` — the user's `data/blacklist.md` do-not-apply list
     (same markdown-table format as the career-ops CLI, e.g.
     `| 1Accord | 2026-08-07 | inbox | Unpaid/free internship — below 3 LPA minimum |`)
     is matched against the sender's from-name + domain, punctuation-insensitive.
     A blacklisted company never notifies, even if the classifier says `job_reply`
     and the email text doesn't mention pay — it is the user's explicit discard.

These gates run for every scan, on every email, whether or not it is in the
classify cache.

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

- `bridge-server.mjs` (`/email/*`, `/email/scan`, `/notifications/check`,
  `/interview/detect`, `fetchGmailInboxREST`, `scanInboxForUser`,
  `classifyEmailViaBridge`, `isBelowCompensationEmail`, `isBlacklistedSender`,
  `DIGEST_SENDERS`)
- `ChatViewModel.kt` (`startInboxPolling` classifier gate)
- `DailyAutomationWorker.kt` (classifier-gated draft notifications)
- `_check_inbox.mjs`, `_check_creds.mjs` (helpers)

## Links

- [[Google OAuth]] — the token it relies on
- [[Bridge Server]] — HTTP surface
- [[Application Tracker]] — replies update application status
- [[Security & Human-in-the-loop]] — send confirmation rule
