---
type: flow
tags: [flow, scan, discovery]
updated: 2026-08-05
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
