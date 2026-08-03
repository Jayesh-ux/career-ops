---
type: component
tags: [component, orchestration, bridge]
updated: 2026-08-03
---

# Start Bridge

Process orchestration for the local backend stack. Brings up everything the
[[Android App]] and the CLI need, detached, with one command.

## What it starts

1. Loads `.bridge.env` from the runtime tree into the bridge environment.
2. Kills any stale `opencode serve`.
3. Ensures a dedicated `opencode serve` on port 4096 for end-user agent
   sessions (spawns it if unhealthy).
4. Spawns the [[Bridge Server]] (`bridge-server.mjs`) detached from the runtime
   tree, logging to `bridge.log`.

## Runtime vs working tree

The bridge runs from `/data/data/com.termux/files/home/career-ops/` (the
runtime tree). After editing `bridge-server.mjs` in the working copy, you must
`cp` it to the runtime tree, verify md5, **kill the old PID**, and re-run
`node start-bridge.mjs`. `apply-job.mjs` / `login-session.mjs` pick up changes
per-spawn without a restart.

## Related files

- `start-bridge.mjs`
- `bridge.log`
- `.bridge.env`

## Links

- [[Bridge Server]] — the process it launches
- [[Portal Session]] — spawned per login session
- [[Playwright Automation]] — spawned scripts
- [[Android App]] — depends on the whole stack
