---
type: tool
tags: [tool, updater, maintenance]
updated: 2026-08-03
---

# System Updater

Self-update that safely pulls new **system files** without touching **user
data**. The mechanism that enforces [[Data Contract]] in practice.

## How it works

1. Backs up current system files.
2. Fetches the new updater and resolves its import closure (so a fresh import
   can't break the upgrade).
3. Re-execs the target updater.
4. Checks out **only** `SYSTEM_PATHS`; `BOOTSTRAP_PATHS` covers very old
   installs. User paths are never overwritten.

## Related files

- `update-system.mjs`
- `SYSTEM_PATHS` / `USER_PATHS` lists
- `updater-migration-tests.mjs`

## Links

- [[Data Contract]] — the boundary it enforces
- [[Bridge Server]] — the runtime copy that must stay in sync
- [[Android App]] — ships independently as an APK
