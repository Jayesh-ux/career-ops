---
type: flow
tags: [flow, followup, scheduler, daily]
updated: 2026-10-04
---

# Daily Hunt (automation)

The unattended daily loop that scans, triages, and — critically — **sends
follow-ups** on warm application threads until an interview is scheduled.
Two layers, one send window.

## Layers

1. **Bridge scheduler** — `scheduler.mjs`, imported and started by
   [[Bridge Server]] on boot. Discovers user dirs that are **email-shaped**
   under `data/users/` (rejects stray project-tree copies like
   `data/users/career-ops/` that happen to contain a `profile.yml`) and runs a
   fixed-hour pipeline: scan (06h), inbox triage (06h), auto-evaluate (06h),
   follow-up (08h), daily adapt (20h) — all UTC hours. Checkpoints per user in
   `.scheduler-checkpoint.json`.
2. **Daily-hunt engine** — `cron/daily-hunt.mjs`, the actual work:
   - **Scan** — `scan.mjs` (location-filtered, EU boards disabled; see
     [[Job Scanning]]).
   - **Triage** — `/email/triage`, then strips job-board alert senders
     (Indeed/LinkedIn/Internshala/Shine/Jobrapido/… and the user's own sent
     mail) so only real recruiter signals surface.
   - **Follow-ups** — reads `/followups` (cadence engine), filters to due
     threads, **prioritizes stalled-interview > responded > applied, freshest
     first**, drafts each via `/followup/draft` (opencode, resume-grounded),
     sends via `/email/reply/send` (thread-aware branded HTML), and appends a
     row to `data/follow-ups.md` so the cadence advances. Capped at
     `FOLLOWUP_MAX_PER_RUN` (default 3) per run.
   - **Digest** — writes `data/users/<id>/data/hunt-digests/YYYY-MM-DD.md` +
     appends to `runs.log`.

## Single send window (no double-sends)

The cron entry `cron/daily-hunt-cron.sh` (08:00 IST Mon–Sat = 02:30 UTC) is the
*only* window that auto-sends. The scheduler's 08h follow-up kick shells out to
the same engine with `AUTO_SEND_FOLLOWUPS=0` (dry-run) unless
`SCHEDULER_FOLLOWUP_AUTOSEND=1`, so a thread is never nagged twice in a day and
the digest still refreshes if the bridge restarted. `cron/bridge-watchdog.sh`
(health every 5 min, `setsid` restart) keeps the bridge alive under cron.

## Follow-up guardrails

- **Only tracker threads with real contacts** are auto-followed. Cold/new
  applications are never auto-sent — they surface in the digest for review.
- `offer`/`rejected` excluded; fresh `interview` threads only nagged when
  stalled >3 days past the next step AND notes record a promised deliverable
  (assessment/task/round) the recruiter hasn't delivered.
- `applied_max_followups` (default 2) → after that a thread is `cold`.
- Every send is logged in `data/follow-ups.md`; manual prior follow-ups should
  be seeded there so the cadence starts honest.

## Related files

- `cron/daily-hunt.mjs`, `cron/RUNBOOK.md`, `cron/daily-hunt-cron.sh`,
  `cron/bridge-watchdog.sh`
- `scheduler.mjs`
- `followup-cadence.mjs` (cadence math: urgency, next dates, max nags)
- `data/users/<id>/data/follow-ups.md` (log + `- next #N <date>` pins)
- See also: [[Job Scanning]], [[IMAP Email]], [[Bridge Server]]