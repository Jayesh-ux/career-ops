---
type: boundary
tags: [boundary, data, multi-user]
updated: 2026-08-03
---

# Multi-user Data Model

Everything is stored **per user**, resolved from the `X-User-Id` header (an
email like `hsinghjayesh@gmail.com`). This is what lets one bridge serve many
users without cross-contamination.

## Layout

```
data/users/<email>/
  .pwprofile/        Playwright persistent browser profile + cookie DB
  data/              cv.md, tracker data
  reports/           evaluation reports
  config/            profile.yml
  batch/             tracker additions
```

## Resolution

`resolveUserDataDir(userId)` lowercases + sanitizes the email, creates the tree
on first visit, caches the result, and wires per-user symlinks (`.opencode`,
`modes/`, `cv.md`). Every bridge endpoint resolves the user context from the
header; scripts receive `--user-dir`.

## Why it matters for login

The portal session ([[Portal Session]]) is saved inside
`data/users/<email>/.pwprofile/` — so "one-time login" is **per user**. User A's
Google session never leaks into user B's auto-fill. `GET /portal/session/status`
reads *that user's* cookie DB.

## Related files

- `bridge-server.mjs` (`resolveUserDataDir`, `resolvePerUserPath`)
- `data/users/`

## Links

- [[Data Contract]] — system/user file separation
- [[Portal Session]] — per-user profile
- [[Bridge Server]] — per-user context resolution
- [[Application Tracker]] — per-user tracker paths
