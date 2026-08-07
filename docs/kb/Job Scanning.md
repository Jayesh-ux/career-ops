---
type: flow
tags: [flow, scan, discovery]
updated: 2026-08-07
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
