---
type: component
tags: [component, backend, api]
updated: 2026-08-05
---

# Bridge Server

The **Bridge Server** (`bridge-server.mjs`) is the single local HTTP API that
everything data-facing goes through. The Android app has **no other channel** to
data — all reads/writes route through here, keyed per-user by the `X-User-Id`
header.

## Responsibilities

- Expose REST endpoints: `/health`, `/profile`, `/tracker`, `/email/*`,
  `/login/session/*`, `/login/session/seed`, `/portal/session/status`,
  `/apply/open|fill`, `/cv`, `/resume/upload`, `/scan`, `/auto-pipeline`,
  `/batch`, `/cv/tailor` (2026-08-03 — tailored ATS-optimized CV PDF per role).
- `/resume/upload` (2026-08-05 fix) extracts text via **pdftotext first**, then
  a pdf-parse fallback. pdf-parse ships two shapes — v1 callable, v2
  (ESM-first 2.x) `{ PDFParse: class }` — the fallback loaded the module and
  called it as a function, so any scanned/image-only PDF (pdftotext yields
  nothing) crashed with a 500 `pdfParse is not a function` and the onboarding
  "attach your CV" step failed repeatedly. Now both shapes are loaded
  (`pdfParseFn`/`PDFParseCls`) and text-less PDFs return a **clear 400**:
  "scanned or image-only PDF — upload a text-based PDF or DOCX" instead of
  crashing. OCR is intentionally not bundled.
- Spawn the Node automation scripts (`apply-job.mjs`, `login-session.mjs`,
  `scan.mjs`, etc.) as child processes, passing `--user-dir` for the
  requesting user.
- Own Google OAuth tokens for **IMAP email** (`getUserOAuth`/`setUserOAuth`).
  The OAuth **exchange** endpoint also accepts an optional `cookies` field and
  persists the WebView session cookies (`[seed] via-exchange`) — the reliable
  one-login path, since the separate app-side seed POST was observed failing to
  reach the bridge.
- Own **Gmail send** (`POST /email/send`): per-user OAuth2 (Gmail REST) >
  legacy OAuth2 > app-password SMTP. The sender is **derived from `X-User-Id`
  when the body omits `email`** (2026-08-03 fix — the app's `EmailSendRequest`
  never sends `email`, which used to hard-fail with `email and body are
  required`), and the **user's CV PDF is attached by default**
  (`<userDir>/output/generic-cv.pdf`) so application emails always carry the
  resume. Since 2026-08-04 the endpoint **idempotency-guards** identical sends
  (same user, recipient, company, role) within a 60s window (`_recentEmailSends`)
  and returns `{success:true, duplicate:true}` for the repeat — so a double-tap
  or client retry can never email a recruiter twice.
- Own **application email drafting** (`POST /email/draft`): `fetchJdAndContact`
  scrapes the posting page (plain HTTP, then a headless-Chromium render
  fallback) for a real application email. If the page yields none — Internshala
  & co. hide the company email behind their Apply flow — the prompt instructs
  the spawned agent to **websearch** for the company's real application/HR
  email (company careers page/contact page) and return it as `to`, falling back
  to `""` (and thus Playwright auto-fill) only if nothing verified is found.
  `runOpencode` polls the session until assistant **text** is present (a prior
  idle-count break raced the final text after tool calls, causing
  "opencode produced no text output").
- Own the **scan paths** (`POST /scan`, `GET /scan/stream`): keywords,
  location proximity (`buildNearbyTerms`), and the career-ops rubric scoring
  (`scoreScanResult`) are all driven by the **per-user** profile via
  `readUserProfileRaw(req)` (2026-08-03 multi-user fix — they previously read
  the root profile with `readProfile()`, so results never matched a user's
  actual roles/locations/salary floor).
- Filter scan links through `isJobDetailUrl` so results stay on real postings
  (2026-08-05): the generic noise regex drops login/signup/blog/faq/search/
  alert links, and portal-specific rules keep only true detail URLs. Extended
  to close five gaps: **LinkedIn** requires `/jobs/view/` (drops `/jobs/`
  search/collections), **hirist.tech** requires `/j/` (drops `/c/` category,
  `/k/` keyword, `/job-search/`), **cutshort.io** requires `/job/` (drops
  `/jobs/<category>-jobs` and `/company/`), and **apna.co** requires `/job/`
  (drops `/jobs/...` category pages). Regression coverage lives in
  `diag-urlfilter.mjs`.
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
- Own the **tailored CV path** (`POST /cv/tailor`, 2026-08-03 redesign): a
  *split* design so it stays reliable under stateless opencode timeouts. **Phase
  A** (bridge, synchronous) gathers ALL context — `fetchJdAndContact`, the
  per-user evaluation report (by `reportNum` or company/role fuzzy match over
  `reports/*.md`), the zero-LLM `jd-skill-gap` classifier, the resolved template
  (`cv-templates.mjs resolve cv` with `CAREER_OPS_PROFILE`), and inlines cv +
  profile — into ONE focused opencode call whose only job is to return the
  compact render JSON (no commands/files). **Phase B** (bridge, synchronous)
  runs the deterministic scripts with exact exit codes:
  `build-cv-html` → `verify-cv-facts` (hard **fact gate**) → `generate-pdf`
  (`--allow-reorder`, `--user-dir` SPACED form, optional `--report=NNN`). A gate
  failure re-runs the agent up to 3× with the rejected claims fed back
  ("REJECTED BY THE FACT GATE — remove every mention of these"). Paper format is
  `a4` unless the JD text clearly targets US/Canada. All artifacts land in the
  requesting user's tree (`jds/`, `output/`, `data/pdf-index.tsv`).
- Own the **batch evaluation** path (`POST /batch`, 2026-08-03): caps input at 5
  URLs and delegates each one to the shared `runAutoPipeline(req, {...})` helper
  that also backs `/auto-pipeline` — so every batch result is a **grounded**
  evaluation (JD + contact fetched first, per-user report written, tracker TSV
  updated, contact fields captured, opencode warmup retried up to 3× with 10s
  backoff) and returns `url, score, company, role, reportNum, reportPath, fit,
  strengths, gaps, contactEmails, contactPhones`. The app renders one
  `BatchReviewCard` per result and passes `reportNum` straight to `/cv/tailor`.
- Guard **opencode concurrency** (2026-08-05): every prompt runs through a FIFO
  semaphore (`OPENCODE_MAX_CONCURRENT = 1` + `opencodeWaiters`) because the
  `opencode serve` instance runs ONE prompt at a time — parallel stateless
  calls (overlapping `/auto-pipeline`, `/batch`, email drafts, classifies)
  previously contended on the same model slot, blew past the per-call timeout,
  and returned N/A evals. `runOpencode` now computes a **deadline**, awaits the
  slot, and delegates to `runOpencodePrompt`, which fails fast when the queue
  wait consumed the deadline (a deep queue degrades gracefully instead of
  stealing the model slot). Evaluation requests are also **coalesced + cached**
  (`runAutoPipeline` wrapper over `runAutoPipelineInner`): in-flight evals for
  the same `userId|url` share one promise, and results are cached for 10 min
  (`EVAL_CACHE_TTL_MS`), so double-taps, client retries, and `/batch` never
  re-run opencode or write duplicate tracker rows. The eval's tracker write
  also **merges via an absolute script path** (`join(__dirname,
  'merge-tracker.mjs')` + `--user-dir`), fixing a bug where `node
  merge-tracker.mjs` was spawned from the per-user cwd and silently failed to
  find the module — leaving eval rows stranded in `batch/tracker-additions/`
  and never merged into `data/applications.md`.

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
- [[CV & PDF Generation]] — the tailored-CV pipeline `/cv/tailor` drives
