# Daily Hunt — RUNBOOK

The proven, day-0-to-offer job-search loop, automated. Rooted in the batch
playbook that landed prior interviews (see `docs/kb/Batch Pipeline Training
Baseline.md`), wrapped in a cron-able engine that runs **every IST workday**
and stops chasing a thread the moment an interview is scheduled.

## What runs, and when

The engine (`cron/daily-hunt.mjs`) runs as a bridge-managed daily scheduler
plus a belt-and-braces crontab entry. Each morning (IST) it does four things:

| Phase | What it does | Auto-sends? |
|-------|--------------|-------------|
| 1. Scan | Runs `node scan.mjs` (location-filtered to the Mumbai/near-Kalyan zone; EU boards disabled) → new in-zone offers land in `data/pipeline.md` | No — new offers are surfaced for YOUR review |
| 2. Triage | `/email/triage` on the last 3 days; filters out job-board alerts (Indeed/LinkedIn/Internshala/etc. and your own sent mail) → real recruiter replies grouped by interview/offer/rejection/recruiter | No — read-only signal |
| 3. Follow-ups | `/followups` cadence → drafts each due thread via opencode → **sends** the follow-up → logs it to `data/follow-ups.md` so cadence advances | **Yes** — capped (default 3/run) |
| 4. Digest | Writes `data/users/<you>/data/hunt-digests/YYYY-MM-DD.md` + appends to `runs.log` | — |

### Follow-up rules (the important part)

- **Only threads already in the tracker** with a real contact get follow-ups.
  Cold/new applications are never auto-sent.
- **Priority order** for the daily cap: stalled-interview (recruiter owes a
  promised assessment/task/round) > responded > applied; freshest-due first, so
  ancient leads can't eat the cap.
- **Stops automatically**: `offer`/`rejected` are excluded. Fresh `interview`
  threads are only nagged if stalled >3 days past the next-step AND the notes
  record a promised deliverable the recruiter hasn't delivered.
- **Max nags**: `applied_max_followups` (default 2) — after that a thread goes
  `cold` and cadence stops proposing it.
- **No spam**: hard cap per run (`FOLLOWUP_MAX_PER_RUN`, default 3), and each
  follow-up is logged so a thread isn't re-nagged before its next cadence date.

### Claim-grounding (non-negotiable)

Follow-up drafts are generated from the real resume (`/followup/draft` reads
the user CV). Nothing is invented: no placeholder domains, no embellished
metrics, no degree-wording shortcuts. Every draft is diffable against the
resume text.

## Manual use

```bash
# Dry run (nothing sends) — see what WOULD happen today:
AUTO_SEND_FOLLOWUPS=0 node cron/daily-hunt.mjs

# Follow-ups only (no scan), dry run:
AUTO_SEND_FOLLOWUPS=0 FOLLOWUP_MAX_PER_RUN=3 node cron/daily-hunt.mjs --followups-only --user-dir data/users/<you>

# Live run (auto-sends up to 3 follow-ups):
AUTO_SEND_FOLLOWUPS=1 node cron/daily-hunt.mjs

# Check what's due first (cadence dashboard):
curl -s http://127.0.0.1:8787/followups -H "X-User-Id: <you>"
```

## Env knobs

| Var | Default | Meaning |
|-----|---------|---------|
| `AUTO_SEND_FOLLOWUPS` | `1` | `1` sends, `0` = dry-run (drafts only, lists what would send) |
| `FOLLOWUP_MAX_PER_RUN` | `3` | Hard cap on follow-up sends per run |
| `SCAN` | `1` | `0` skips the portal scan phase |
| `BRIDGE_URL` | `http://127.0.0.1:8787` | Bridge endpoint |
| `USER_ID` | (from `--user-dir`) | Mailbox to act as |

## Bridge + scheduler

- The bridge (`bridge-server.mjs`) starts `scheduler.mjs` on boot. The
  scheduler discovers users (email-shaped dirs under `data/users/`) and runs
  the daily pipeline at fixed UTC hours; its 08:00 follow-up step shells out to
  `cron/daily-hunt.mjs --followups-only` so the email actually goes out and the
  cadence log advances (not just the dry analysis).
- A crontab watchdog restarts the bridge if it dies (see the installed crontab:
  `*/5 * * * *` health-check + restart).
- Both layers are safe by default: drafts are human-reviewable via the digest,
  and every send is recorded in `applications.md` + `follow-ups.md`.

## Cadence model (defaults)

```
applied:    1st follow-up at day 7, then every 7 days, max 2
responded:  initial within 1 day, then every 3 days
interview:  thank-you within 1 day; stalled-interview chase if >3d late
```

Overrides: put a `followup_cadence:` block in the user's `config/profile.yml`,
or pin a specific app's next date in `data/follow-ups.md`:
`- next #42 2026-07-10 (set 2026-07-02)`.

## In this repo

- `cron/daily-hunt.mjs` — the automation engine
- `scheduler.mjs` — daily scheduler wired into the bridge (follow-up step shells to the engine)
- `followup-cadence.mjs` — cadence math (urgency, next dates, max nags, pins)
- `data/users/<you>/data/follow-ups.md` — log of sent follow-ups (cadence source of truth)
- `data/users/<you>/data/hunt-digests/` — daily digest + `runs.log`