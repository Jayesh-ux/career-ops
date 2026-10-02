---
type: component
tags: [component, backend, api]
updated: 2026-10-02
---

# Bridge Server

The **Bridge Server** (`bridge-server.mjs`) is the single local HTTP API that
everything data-facing goes through. The Android app has **no other channel** to
data — all reads/writes route through here, keyed per-user by the `X-User-Id`
header.

## Responsibilities

- Expose REST endpoints: `/health`, `/profile`, `/tracker`, `/email/*`,
  `/login/session/*`, `/login/session/seed`, `/portal/session/status`,
  `/apply/open|fill`, `/cv`, `/resume/upload`, `/scan`, `/scan/results`,
  `/auto-pipeline`,
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
  required`), and the **user's CV PDF is attached by default** so application
  emails always carry the resume. The default attachment is resolved by
  `resolveResumePdf(userDir, company, candidateName)` (2026-10-02): it prefers
  the **user's exact resume as provided** (`output/current-resume.pdf` — a
  byte-for-byte copy of the resume from the job-apply folder, never regenerated
  or restyled), then `output/generic-cv.pdf`, then any existing PDF. Only the
  **outreach email HTML is themed** (portfolio dark theme via `email-html.mjs`);
  the CV/resume is exactly what the user provided and is never modified.
  Since 2026-08-04 the endpoint **idempotency-guards** identical sends
  (same user, recipient, company, role) within a 60s window (`_recentEmailSends`)
  and returns `{success:true, duplicate:true}` for the repeat — so a double-tap
  or client retry can never email a recruiter twice.
- Sends **tailored HTML bodies**: `/email/send` (and `/email/reply/send`,
  `/email/send-confirm`) embed a multipart/alternative pair — plain text plus
  `bodyToHtml(body, company)` from `email-html.mjs` — nested in the outer
  multipart/mixed envelope, matching Jayesh's portfolio dark theme. The SMTP
  nodemailer fallback passes the same HTML via `mailOpts.html`.
- Own **application email drafting** (`POST /email/draft`): `fetchJdAndContact`
  scrapes the posting page (plain HTTP, then a headless-Chromium render
  fallback) for a real application email. If the page yields none — Internshala
  & co. hide the company email behind their Apply flow — the prompt instructs
  the spawned agent to **websearch** for the company's real application/HR
  email (company careers page/contact page) and return it as `to`, falling back
  to `""` (and thus Playwright auto-fill) only if nothing verified is found.
  `runOpencode` polls the session until assistant **text** is present (a prior
   idle-count break raced the final text after tool calls, causing
   "opencode produced no text output"). **Draft timeout (2026-08-08)**: the
   main draft's opencode budget was 180s, but the reasoning model routinely
   takes ~3min for a grounded letter — a live apply with a JD fetch + the
   websearch contact lookup blew past it and failed with `opencode prompt
   timeout`. Raised the main draft to 300s and the contact-lookup pass to 120s
   (still fits the app's 600s read timeout).
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
  requesting user's tree (`jds/`, `output/`, `data/pdf-index.tsv`). The gate
  (2026-08-05) rejects metric-like claims **and** employer/education orgs absent
  from the sources, and the bridge passes the user's `profile.yml` in as a
  second source alongside `cv.md`.
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
- Own the **email-inbox scan** (`fetchGmailInboxREST`, 2026-08-06 → 08-07
  hardening): the Gmail REST list previously capped at 50 messages
  (`Math.min(maxEmails, 50)` on a single page) — roughly two days of inbox
  volume — so older recruiter outreach was invisible to the app, the worker, and
  `/notifications/check`. It now **paginates with `nextPageToken`** up to a
  5000-message cap for backfills (a 250-cap still truncated the 90-day window —
  this mailbox holds **2035 messages** in 90 days), fetches bodies in bounded
  chunks (**concurrency 10**) with a **3-attempt retry**, and returns any
  still-failing messages as `failedIds` instead of silently dropping them.
  `/email/inbox` also accepts a **`query`** param passed straight to the Gmail
  API and an **`ids`** param to fetch specific messages by id.
  **`POST /email/scan`** (`scanInboxForUser`) is the cursor-based scan the app /
  daily worker use: per-user `inbox-cursor.json` (`lastScanAt`, `processedIds`,
  `pendingIds`) + `email-classify-cache.json`. First run (or `forceBackfill`)
  does a one-time 90-day backfill (up to 5000 msgs); later runs scan the last
  scan + 2-day overlap, classifying each email exactly once. Failed fetch /
  classify messages go to `pendingIds` and are re-fetched **by id** each scan so
  nothing is ever lost; progress is persisted every 50 classifications so an
  interrupted backfill resumes (and `lastScanAt` only advances on completion).
  Recruiter-reply / offer / interview notifications are **durable**: queued to
  `pending-notifications.json` as found and replayed by `/email/scan` and
  `/notifications/check`, cleared only after the response is written — a lost
  response (client timeout on a long backfill) never loses the opportunity.
  Detection in `/notifications/check` and `/interview/detect` is now
  **classifier-gated**: after a cheap keyword pre-filter, each candidate email
  is sent to the opencode-backed `/email/classify` via the shared
  `classifyEmailViaBridge` helper, and only `job_reply` messages with
  confidence ≥ 0.7 — that also pass the shared `DIGEST_SENDERS` blocklist
  (job boards + digest/newsletter/no-reply senders, expanded with pinterest,
  instahyre, foundit, github, havells, stackoverflow, render.com, edureka) —
  can surface as recruiter replies, offers, or interview records. This replaced
  the regex-only detection that was writing fake interviews (Quora/Indeed/
  Internshala digests, Edureka bootcamps) into `interviews.json`; the file was
  purged to `[]` and stays empty. The Android app (`ChatViewModel.startInboxPolling`,
  `DailyAutomationWorker`) mirrors the same gate against `/email/classify`.
  Note: `/email/classify` runs opencode per candidate, so the keyword
  pre-filter keeps each check bounded.
   **Full-listing scan rework (2026-08-11)**: a 90-day backfill of this mailbox
   once took 2m+ (2000 full HTML bodies, ~0.7s each) and even then surfaced a
   Jobrapido job-board alert as a recruiter reply. `scanInboxForUser`'s
   full-listing branch is now a three-step pipeline: (1) an **ids-only** pass
   (`listGmailIds` helper, `/email/inbox?idsOnly=true`, digest exclusions applied)
   returns ids with no per-message GETs; (2) **metadata** (headers+snippet) is
   fetched only for ids missing from the per-user `inbox-meta-cache.json`
   (bounded to the newest 5000, saved after each run); (3) **full bodies** are
   fetched only for emails whose cached verdict is a confident job_reply or that
   pass the cheap `isPlausibleRecruiterMail(subject, preview)` pre-filter.
   `DIGEST_SENDERS` + `DIGEST_DOMAIN_EXCLUSIONS` grew with the mailbox's real
   noise (jobrapido, internshala, jobhai, timesjobs, shine, iimjobs, cutshort,
   freshersworld, workindia, apna, kotak, magicbricks, consumer-app alerts);
   google/amazon/microsoft/adobe/redhat/apple stay eligible as employers.
   Result: a 90-day scan dropped from 2m+ to ~21s and the Jobrapido false
   positive is gone (verified: QualityKiosk interview still surfaces).
   **Gmail gotchas learned here**: `-from:(a b c)` (parenthesized space-list) is
   silently ignored by Gmail — use repeated `-from:a -from:b -from:c`;
   `resultSizeEstimate` caps at 201 so compare fetched id sets, never the
   estimate; duplicate keys in a `URLSearchParams({...})` object literal collapse
   (empty From/Subject headers) — use `.append()` per key.
   **Salary gate (2026-08-07)**: `/email/classify` injects the candidate's
  `config/profile.yml` `compensation` (minimum 3 LPA, target 3-12 LPA) into its
  prompt and mandates that unpaid/free-internship / below-minimum offers classify
  as `spam`. `classifyEmailViaBridge` now sends up to 2000 chars of body. Two
  cheap sync gates in `scanInboxForUser`'s `handleEmail` run before classify (so
  they also cover cached verdicts): `isBelowCompensationEmail` (regex on
  unpaid/free-intern/no-stipend signals) and `isBlacklistedSender` (the user's
  `data/blacklist.md` do-not-apply table, e.g. 1Accord) — both skip the email
  without notifying.
  **Scan filtering (2026-08-07)**: `/scan/stream` now drops two kinds of noise
  before scoring. **Tracker exclusion** — `buildTrackerExclusion` previously
  matched tracker company names exactly, but tracker rows carry clutter ("Shine —
  Mumbai") that never equals a clean scan hit. Results are now filtered through
  `isTrackerExcluded` using `normalizeCompanyForExclusion` (lowercase, strip
  punctuation, remove location/suffix suffixes) + **substring containment both
  ways**, so a listed-applied company never reappears in scan results. **Salary
  floor** — `parseSalaryLpa()` (regex handles `₹6-8 LPA`, `₹20k/mo` → 2.4,
  `Competitive` → null) + the per-user profile's `compensation.minimum`
  (3 LPA) form a hard gate: a **parseable** salary below the floor is dropped;
  unknown/negotiable salaries pass. Both filters update the `excludedSalary`
  counter in the summary and the "widening" step.
  **Profile-driven source relevance (2026-08-07)**: `/scan` + `/scan/stream`
  gate every enabled source through `isRelevantSource(entry, section)` before
  it becomes a target. Genuine job boards — a portal with a region-scoped
  `location`, an explicit `provider`, or a `search_queries` entry — always
  scan; company career pages scan only when their `name + notes` match the
  user's target-role terms (`kw` minus generic tokens like `engineer`) or
  `domainTerms` extracted from `narrative` (exit_story + superpowers,
  stop-word filtered: fintech/logistics/recruitment/...); remote-only boards
  scan only when `candidate.location_flexibility` allows remote/hybrid. No
  hardcoded company lists — `portals.yml` stays generic (this replaced the
  earlier hardcoded source blocklist). Skipped sources bump the
  `excludedSources` counter surfaced in the done summary and the "widening"
  step; the per-user `data/blacklist.md` remains the explicit override.
  **Per-role scan phase (2026-08-07)**: `/scan/stream` iterates every role in
  `target_roles.primary` (from the requesting user's profile) in a dedicated
  `phase: 'roles'` step between the portal websearch phase and the Playwright
  phase. `buildRoleSearchSpecs()` builds per-role search URLs (portal URL
  templates × the profile's commuting location from `location_flexibility`) and
  per-role keyword sets; each URL is fetched (HTTP-first) with the profile's
  salary floor + `isJobDetailUrl` applied in-phase, and anything the plain
  fetch can't render joins Phase 3's Playwright retry carrying `_roleKw` so
  matching stays per-role. Added genuine Indian portals to `portals.yml`
  `job_boards` (Monster, TechGig, Jora, Jooble, Talent.com, Hirect, all Tier 2
   `expand_on_rerun`) + free no-key API boards (Remotive, Arbeitnow via their
   `providers/*`) which the `isRelevantSource` gate auto-skips for on-site
   profiles and auto-includes for remote/hybrid ones. Per-role result cards use
   a human-readable location label (slug → title case, e.g. `mumbai` → `Mumbai`);
   the URL keeps the lowercase slug and location matching is case-insensitive.
   **Employer resolution (2026-08-07, extended 2026-08-08)**: portal-sourced
   titles embed the real employer (`Kiya.ai - Automation Engineer -
   Python/Ansible`); the role phase, the Phase 3 Playwright retry paths (remote
   proxy + local Chromium), **and the Phase 2 websearch loop** run titles
   through `employerFromPortalTitle(portal, title, rolePhrases)` and
   `stripCompanyPrefix` so the tracker/dedup record the **employer**, never the
   portal. `rolePhrases` = the user's own `target_roles` (primary + archetypes,
   lowercased) carried on each spec (`spec.rolePhrases`), each Playwright retry
   entry (`_rolePhrases`), and — since 2026-08-08 — a handler-level
   `profileRolePhrases` list for the websearch phase, with `portalNameKey()`
   reducing location-suffixed board names (`Shine — Mumbai` → `shine`) so the
    portal-id set keys correctly. Prefixes matching a user role or a
    language-neutral listing marker (`jobs|job|careers|career|hiring|vacancy|
    openings|apply|position|roles|role`) fall back to the portal name. No
    hardcoded role/employer dictionary — detection is profile-driven, so it
    adapts to any user.
    **Result-count fix (2026-08-08)**: the employer heuristic above could
    mislabel ROLE titles as the employer — `Software Development Engineer -
    Backend Technologies` (LinkedIn) or `Technical Lead - Backend` have a
    role prefix, not a company, so dedup's `company::role` key then collapsed
    every distinct posting sharing that prefix (250+ results → ~45). Three
    fixes in `bridge-server.mjs`:
    1. `extractEmployerFromUrl()` pulls the real company slug from job URLs
       (LinkedIn `-at-<company>-<id>`, Shine `/jobs/<slug>/<company>/<id>`,
       Internshala `-at-<company><id>`), rendered via `slugToName`.
    2. `employerFromPortalTitle(portal, title, rolePhrases, url)` rejects
       role-looking dash-prefixes (`ROLE_TOKEN_RE` — developer/engineer/manager/
       analyst/consultant/… + walk/drive/event) and falls back to the URL
       company; a confident title prefix still wins.
    3. Dedup is gated by `isConfidentEmployer(company)`: unknown-employer rows
       (portal name or role-like label) dedup by **URL only** so distinct jobs
       never vanish; `normalizeUrlForDedup()` strips LinkedIn tracking params
       + `&amp;` so the same posting viewed N times isn't counted N times.
       Applied in both the final pass and the live `results` snapshots.
    Verified: a live 12-role run returned **535 results** (raw 1468,
    duplicatesSkipped 302, excludedApplied 35), 7/535 role/portal-ish labels —
    and those are real companies (`R3 Consultant`, `Cutshort`).
    **Live results streaming (2026-08-08)**: `GET /scan/stream` now emits
   `results` SSE events (~every 3s) while the scan runs, not only at `done`.
   Each snapshot applies the same profile-driven gates as the final pass —
   `isTrackerExcluded` (which since 2026-08-08 also excludes **`discarded`**
   status), the salary floor, senior-level drop, and URL/company+role dedup.
    The interval is declared at handler scope so the outer catch clears it too;
    `done`/`error` stop the timer. The Android app merges each `results` event
    into its pinned suggested-jobs list in realtime.
    **Per-user scan-results cache (2026-08-11)**: the final job list of every
    scan (`POST /scan` and `GET /scan/stream` `done`) is persisted per-user to
    `data/users/<email>/data/scan-results-cache.json` (`saveScanResultsCache`),
    and **`GET /scan/results`** returns it instantly
    (`{cached:true, savedAt, results, otherLocations, total, newFound, ...}`) or
    an empty `cached:false` payload. The app restores the pinned suggested-jobs
    list from this server cache on open; re-running a scan overwrites the cache
    with the latest results ("scan again" = update the list). An empty result
    set (e.g. every portal errored) never overwrites an existing cache, so a
    flaky scan can't wipe a good list. `POST /email/scan`
    logs `[email/scan] start/done/error` (userId, daysBack, count, scanned,
    elapsed ms) for diagnosing app-side "check inbox" failures.
- Own **thread-aware recruiter replies** (`POST /email/reply` + `/email/reply/send`,
  2026-08-07 rewrite): `/email/reply` accepts `to`/`subject`/`originalBody`/`body`
  plus `inReplyTo`/`messageId`/`threadId` and returns
  `replyBody`/`subject: Re: ...`/`to`/`inReplyTo`/`threadId` so the app can carry
  the full thread chain to the reply. Drafting no longer hard-requires `to`
  (follow-up drafts are allowed); sending still requires `to`. `/email/reply/send`
  adds `In-Reply-To` + `References` headers and forwards `threadId` in the Gmail
  REST send body so replies land inside the original conversation.
- **Tailored HTML bodies** (2026-09-30): every Gmail/IMAP send path now emits a
  branded HTML alternative alongside plain text via `email-html.mjs` —
  `buildRfc2822Message` (used by `/email/send` OAuth REST and
  `/email/reply/send`) builds `multipart/alternative` (7bit text + base64 HTML),
  the nodemailer SMTP fallback passes `html: bodyToHtml(body, company)`, and
  `/email/send-confirm` does the same. `<li>` bullets and a styled
  "Best regards" signature are auto-detected from the plain body.
- Own **spam deletion** (`POST /email/spam/delete`, HITL): OAuth users go through
  Gmail REST, app-password users through IMAP. The OAuth path resolves the
  selected `messageIds` (Gmail ids pass through; sequential ids from
  `/email/inbox` map via a fresh `fetchGmailInboxREST` pass), optionally clears
  UNREAD via `messages.modify`, then moves each message to the **Trash** with
  `POST /messages/{id}/trash`. This changed 2026-08-11: `users.messages.delete`
  (permanent purge) requires the `https://mail.google.com/` scope, which the
  app's OAuth token (gmail.readonly/modify/send only) does **not** grant — live
  testing returned `403 PERMISSION_DENIED` ("insufficient authentication
  scopes") on DELETE, so the endpoint now **trashes** instead of purging
  (recoverable, needs only `gmail.modify`). Permanent deletion would require the
  user to re-consent OAuth with the full `mail.google.com/` scope.
  **Base36 id fix (2026-08-11)**: Gmail REST message ids are 16-char base36
  strings (e.g. `19fefbb10e4a9738`), not purely numeric. The original
  `isGmailId` regex (`/^\d{15,19}$/`) sent the app's base36 gmailIds into the
  sequential-id resolution map, every lookup missed, and `/email/spam/delete`
  returned `deleted:0` with a silent `!gmailId` skip (no log). Now `isGmailId`
  is `/^[0-9a-zA-Z]{15,19}$/` and the resolution map is keyed by every
  identifier the app could send (sequential `id`/`uid` AND base36 `gmailId`) so
  resolution cannot miss. Verified live: 15/15 spam moved to Trash.

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
