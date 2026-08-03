---
type: boundary
tags: [boundary, data, contract]
updated: 2026-08-03
---

# Data Contract

The architectural spine: **system files** and **user files** are strictly
separated, and human-readable files are canonical while databases are derived.

## The two layers

- **System layer** — the tool itself: `modes/`, `*.mjs`, templates. Versioned,
  updated by `update-system.mjs` (`SYSTEM_PATHS`).
- **User layer** — your data: `cv.md`, `config/profile.yml`, `data/`,
  `reports/`, `jds/`. The updater **never** touches these (`USER_PATHS`).

## Files are canonical — DBs are derived

`data/applications.md`, `reports/`, `data/pipeline.md` are the permanent source
of truth. SQLite exists only as a derived index for fast queries and will never
become a primary store. Reason: every reader (web UI, dashboard, plugins, fork
scripts) reads the files; a second canonical store would break them all.

## Multi-user extension

The boundary now runs **per user** under `data/users/<email>/` — see
[[Multi-user Data Model]]. The system/user rule applies inside each user tree.

## Related files

- `DATA_CONTRACT.md`
- `updater-migration-tests.mjs` (enforces the boundary)
- `update-system.mjs` ([[System Updater]])

## Links

- [[Multi-user Data Model]] — per-user variant
- [[System Updater]] — enforces SYSTEM_PATHS
- [[Application Tracker]] — files-first tracking
- [[Evaluation Engine]] — writes reports into the user layer
