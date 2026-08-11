---
type: flow
tags: [flow, scan, discovery]
updated: 2026-08-08
---

# Job Scanning

Finding roles before they cost evaluation time. Zero-token discovery where
possible, Playwright for auth-gated career pages.

## Two tiers

1. **Open sources** — `scan.mjs` calls public ATS APIs (Greenhouse, Ashby,
   Lever, BambooHR, Teamtailor, Workday, Breezy) and RSS/JSON boards via
   `providers/*`. No auth needed.
2. **Auth-gated portals** — Internshala, Naukri, Shine, TimesJobs, etc. use
   Playwright with the saved [[Portal Session]] so logged-in pages render
   real openings. Output lands in `data/pipeline.md`.

## Known gaps (recorded 2026-08-03)

- **Scan results were not aligned to the per-user profile.** `POST /scan`,
  `GET /scan/stream`, and the rubric scoring read the **root**
  `config/profile.yml` via `readProfile()` instead of the requesting user's
  profile — so role keywords, location proximity, and scores came from a
  stale/partial role set. Fixed in `bridge-server.mjs` (2026-08-03): all three
  scan paths now read `readUserProfileRaw(req)`, so keywords, nearby-location
  terms, and scoring follow each user's `data/users/<id>/config/profile.yml`.
  See [[Bridge Server]].
- **Scan results were inflated by non-posting noise.** Shine `/job-search/`,
  Indeed `/q-...` + `/career/salaries`, Internshala `/jobs/` category pages,
  courses, LinkedIn `/jobs/` lists, hirist `/c/` + `/k/` + `/job-search/`,
  cutshort `/jobs/` + `/company/`, apna `/jobs/` category pages, and footer
  links all surfaced as "jobs". Fixed in `bridge-server.mjs` (2026-08-05):
  `isJobDetailUrl` now whitelists the real detail-URL shapes per portal
  (LinkedIn `/jobs/view/`, hirist `/j/`, cutshort `/job/`, apna `/job/`, …)
  and is applied by `/scan` + `/scan/stream`. Regression cases live in
  `diag-urlfilter.mjs`.
- **Shared `portals.yml` must not carry per-user filters.** The bridge is
  multi-user; title/location/salary filters that belong to one user would
  leak to everyone. Per-user alignment (target roles, cities, salary floor,
  remote/hybrid flexibility) must live in each user's `profile.yml`, which
  the bridge scan paths now read. CLI `scan.mjs` still honours only the
  shared `portals.yml` filters (it has no per-keyword/location/salary flags).
- **JD-scored output is on the probe path, not in `/scan`.** `/scan`/`/scan/stream`
  score titles + notes + location proximity; full JD-text scoring (salary
  parsing, skill gaps) needs the JD scraped via Playwright
  (`probe-jd.mjs` in the runtime tree) and fed to the [[Evaluation Engine]].
- **Scans wasted time on non-relevant sources.** `tracked_companies` and the
  `job_boards` company pages mix international career pages (Twilio, Genesys,
  Salesforce), Indian gig/consumer pages (Zomato, Swiggy, Dream11, Ola, edtech),
  and remote boards together with the genuine Indian portals — so `/scan/stream`
  queried irrelevant sources every run. Fixed (2026-08-07): a **profile-driven
  source gate** `isRelevantSource(entry, section)` decides each enabled source
  before it becomes a target. Genuine job boards (region-scoped `location`,
  explicit `provider`, or a `search_queries` entry) always scan; company career
  pages scan only when their `name + notes` match the user's own target-role
  terms or `domainTerms` derived from `narrative` (exit_story + superpowers,
  stop-word filtered — e.g. fintech/logistics/recruitment for this profile);
  remote-only boards scan only when the profile allows remote/hybrid. There are
  **no hardcoded company lists**, so the gate adapts to any user's profile.
  Skipped sources bump the `excludedSources` counter reported in the done
  summary and the "widening" step. Explicit per-user exclusions still live in
  `data/blacklist.md`, which is honoured after the gate.
- **One scan OR-ed every onboarding role into a single keyword blob**, so each
  role never got a dedicated portal search and listings were sparse. Fixed
  (2026-08-07): `/scan/stream` now runs a **per-role search phase (Phase 2.5,
  `phase: 'roles'`)** built from `buildRoleSearchSpecs(userProfile)` — it
  iterates EVERY `target_roles.primary` role, each role × the profile's
  locations (commuting metro from `location_flexibility` first, profile city as
  fallback) × the salary floor, generating per-role search URLs on genuine
  Indian portals (Naukri, Indeed, Shine, Foundit, TimesJobs, Hirist,
  Internshala, LinkedIn tier 1; iimjobs, Monster, TechGig, Jora, Jooble,
  Talent.com, Hirect, and a DuckDuckGo websearch proxy for Google/Jobs
  discovery on "Scan again"). Portals the plain HTTP fetch can't render are
  queued into the Phase 3 Playwright retry (browser reuse) with a per-role
  keyword set (`_roleKw`) so matching stays role-specific. Salary floor +
   `isJobDetailUrl` apply in-phase; no hardcoded roles/companies — the specs
   come from the user's own profile, so any onboarding profile is covered.
- **Portal names leaked into results as the company.** Role-search (Phase 2.5)
  and its Phase 3 Playwright retries recorded `company: <portal>` (e.g.
  `LinkedIn`) because the real employer is embedded in the portal title
  (`Kiya.ai - Automation Engineer - Python/Ansible`). Applying to one LinkedIn
  job then recorded "LinkedIn" in the tracker, and the app's anti-spam gate
  falsely blocked every other LinkedIn-sourced job ("Already applied to
  LinkedIn"). Fixed in `bridge-server.mjs` (2026-08-07): `employerFromPortalTitle`
  splits `"Employer - Role - ..."` titles on portal-sourced results — it returns
  the prefix as the employer UNLESS the prefix contains one of the user's OWN
  onboarding roles (`rolePhrases`, from the same `target_roles` that drive the
  scan — no hardcoded role dictionary) or a language-neutral listing marker
  (jobs/job/careers/hiring/vacancy/...). `stripCompanyPrefix` then removes the
  employer from the displayed title. `rolePhrases` is threaded through the spec
  (`spec.rolePhrases`) and the Phase 3 Playwright retry entries (`_rolePhrases`),
  and both Phase 3 paths (remote proxy + local Chromium) resolve the employer the
  same way. **Extended (2026-08-08): the Phase 2 websearch loop** (search-query
  boards such as `Shine — Mumbai`) now resolves the employer the same way — a
  handler-level `profileRolePhrases` list plus a `portalNameKey()` helper reduce
  `"Shine — Mumbai"` → `shine` so the portal-id set keys correctly. The app side
  (`ChatViewModel.removeAppliedFromSuggested`) now also removes the exact
  applied job by URL in addition to by company.
- **Scan results only surfaced at the end of the run.** `/scan/stream` filtered
  everything and emitted a single `done` event, so the app's pinned suggested
  list stayed empty until the whole (multi-minute) scan finished. Fixed
  (2026-08-08): the handler streams **live `results` SSE events** on a ~3s
  cadence while the scan runs. Each snapshot applies the same profile-driven
  gates as the final pass — tracker exclusion (applied/responded/interview/
  offer/**discarded**), the salary floor, senior-level drop, and URL/company+role
  dedup — and the timer is cleared on `done` and on error. The app merges every
  `results` event into the pinned suggested-jobs list in realtime.
- **Discarded companies were re-scanned.** `buildTrackerExclusion()` excluded
  only applied/responded/interview/offer statuses, so a company the user
  discarded reappeared on the next scan. Fixed (2026-08-08): `discarded` is now
  part of the active-status exclusion in `/scan`, `/scan/stream`, and the live
  `results` snapshots; the app mirrors it (`isSpammed`, `filterSuggestedAgainstTracker`).
- **Result count collapsed from 250+ to ~45.** The 2026-08-08 employer-resolution
  extension mislabeled ROLE titles as the employer: on LinkedIn/Shine titles like
  `Software Development Engineer - Backend Technologies` or `Technical Lead - Backend`,
  the dash-prefix is a role, not a company, and the real employer only lives in the
  job URL (`...-at-bookmyshow-...`, `/jobs/<slug>/kyzer-software/<id>`). Treating the
  prefix as `company` made the final dedup key (`company::role`) collapse every
  distinct posting sharing that prefix into one row (BookMyShow + Swiggy + ... all
  became `Software Development Engineer :: Backend Technologies`). Fixed
  (2026-08-08) in `bridge-server.mjs`:
  - `extractEmployerFromUrl()` pulls the real company slug from LinkedIn
    (`-at-<company>-<id>`), Shine (`/jobs/<slug>/<company>/<id>`) and Internshala
    (`-at-<company><id>`) URLs; `slugToName` renders it (`kyzer-software` → `Kyzer Software`).
  - `employerFromPortalTitle(portal, title, rolePhrases, url)` now rejects
    role-looking dash-prefixes (`ROLE_TOKEN_RE`, language-level role markers —
    developer/engineer/manager/analyst/consultant/… plus `walk/drive/event`) and
    falls back to the URL company; a confident title prefix still wins (clean).
  - Dedup never collapses distinct URLs under a non-confident employer:
    `isConfidentEmployer(company)` (not a portal name, no role token) gates the
    `company::role` key, so unknown-employer rows dedup by URL only and distinct
    opportunities survive. Same rule in the live `results` snapshots.
  - `normalizeUrlForDedup()` strips LinkedIn tracking params (`position/pageNum/
    refId/trackingId` + `utm_*`) and `&amp;` entities so the same posting viewed
    multiple times is not counted twice.
  Verified on a live 12-role run: **535 results** (raw 1468, duplicatesSkipped 302,
  excludedApplied 35), only 7/535 labels look role/portal-ish (and those are real
  companies: `R3 Consultant`, `Cutshort`).

## Related files

- `scan.mjs`, `providers/`
- `diag-urlfilter.mjs` (junk-filter regression cases for `isJobDetailUrl`)
- `check-liveness.mjs` (skip dead postings)
- `probe-jd.mjs` (runtime tree — Playwright JD scrape for full-text scoring)

## Links

- [[Playwright Automation]] — gated-portal scanning
- [[Portal Session]] — auth for gated portals
- [[Evaluation Engine]] — scores what scanning finds
- [[Application Tracker]] — pipeline.md → tracker
- [[Data Contract]] — pipeline.md lives in the user layer
