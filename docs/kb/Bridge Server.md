---
type: component
tags: [component, backend, api]
updated: 2026-08-03
---

# Bridge Server

The **Bridge Server** (`bridge-server.mjs`) is the single local HTTP API that
everything data-facing goes through. The Android app has **no other channel** to
data — all reads/writes route through here, keyed per-user by the `X-User-Id`
header.

## Responsibilities

- Expose REST endpoints: `/health`, `/profile`, `/tracker`, `/email/*`,
  `/login/session/*`, `/login/session/seed`, `/portal/session/status`,
  `/apply/open|fill`, `/cv`, `/resume/upload`, `/scan`, `/auto-pipeline`.
- Spawn the Node automation scripts (`apply-job.mjs`, `login-session.mjs`,
  `scan.mjs`, etc.) as child processes, passing `--user-dir` for the
  requesting user.
- Own Google OAuth tokens for **IMAP email** (`getUserOAuth`/`setUserOAuth`).
  The OAuth **exchange** endpoint also accepts an optional `cookies` field and
  persists the WebView session cookies (`[seed] via-exchange`) — the reliable
  one-login path, since the separate app-side seed POST was observed failing to
  reach the bridge.
- Own the **seeded portal session**: `POST /login/session/seed` stores the
  WebView session cookies per-user at `<userDir>/google-cookies.json` (requires
  `X-User-Id`; rejected without it), which `seed-cookies.mjs` injects into every
  Playwright spawn. Every seed request — and every rejection reason — is logged
  as `[seed]` so a missed session is attributable (missing header vs. no
  parseable cookies).
- Read the **seeded cookie file + persisted Playwright cookie DB** for portal
  session status (`GET /portal/session/status`) — no browser launch needed.
- Serve the user session for end-user agent chats via the `opencode serve`
  instance started by [[Start Bridge]].

## Design notes

- Runs detached from the runtime tree
  `/data/data/com.termux/files/home/career-ops/` and writes logs to
  `bridge.log`.
- The runtime copy must be kept in sync with the working copy
  (`/root/career-ops/`) — always `cp` + verify md5 after editing.
- **Restart required** after every `bridge-server.mjs` change (it does not
  hot-reload); `apply-job.mjs` and `login-session.mjs` are spawned fresh per
  request, so they pick up changes per-spawn.

## Related files

- `bridge-server.mjs`
- `seed-cookies.mjs` (`seedGoogleCookies`, `loadGoogleCookies`)
- `start-bridge.mjs` ([[Start Bridge]])
- `.bridge.env` (runtime env)

## Links

- [[Android App]] — its only data path
- [[Start Bridge]] — process orchestration
- [[Portal Session]] — the `/portal/session/status` gate
- [[Playwright Automation]] — the spawned scripts
- [[IMAP Email]] — OAuth token handling
- [[Multi-user Data Model]] — per-user resolution
