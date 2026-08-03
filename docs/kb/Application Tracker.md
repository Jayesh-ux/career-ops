---
type: flow
tags: [flow, tracking, applications]
updated: 2026-08-03
---

# Application Tracker

The canonical record of every evaluated offer and its lifecycle. Files are the
brain; SQLite is only a derived index (see [[Data Contract]]).

## Canonical states

`Evaluated → Applied → Responded → Interview → Offer / Rejected / Discarded`

## Storage

- `data/applications.md` — canonical tracker table (human-readable, git-diffable)
- `reports/{NNN}-{company}-{date}.md` — full evaluation reports
- `data/pipeline.md` — discovered postings (scan output)
- SQLite index for fast queries — rebuilt on demand, never a primary store

## Consistency scripts

`merge-tracker.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs`,
`verify-pipeline.mjs`, `reserve-report-num.mjs` keep the files consistent with
atomic writes.

## Access from the app

`GET /tracker`, `PUT /tracker/{id}/status`, `POST /tracker/add` on the
[[Bridge Server]]. [[IMAP Email]] replies move entries to `Responded` /
`Interview`.

## Related files

- `data/applications.md`, `reports/`, `data/pipeline.md`
- `tracker.mjs`, `merge-tracker.mjs`, `set-status.mjs`

## Links

- [[Data Contract]] — files-first doctrine
- [[Evaluation Engine]] — what scores and registers offers
- [[IMAP Email]] — recruiter replies update status
- [[Multi-user Data Model]] — per-user tracker paths
- [[Bridge Server]] — API surface
