---
type: flow
tags: [flow, scan, discovery]
updated: 2026-08-03
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

## Related files

- `scan.mjs`, `providers/`
- `check-liveness.mjs` (skip dead postings)

## Links

- [[Playwright Automation]] — gated-portal scanning
- [[Portal Session]] — auth for gated portals
- [[Evaluation Engine]] — scores what scanning finds
- [[Application Tracker]] — pipeline.md → tracker
- [[Data Contract]] — pipeline.md lives in the user layer
