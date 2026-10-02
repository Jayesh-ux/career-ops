---
type: flow
tags: [flow, batch, training, baseline, cli, 81-applications]
updated: 2026-08-03
---

# Batch Pipeline Training Baseline

Reverse-engineered from the successful CLI run that produced **81 tracked
applications** for Jayesh Singh between 2026-07-04 and 2026-07-21. This note is
the training baseline for replicating that success for **any user** of
career-ops — not a Jayesh-specific playbook. Every claim below traces to real
files under `batch/`, `reports/`, `modes/`, and `data/applications.md`.

## The outcome we are replicating

`data/applications.md` holds **78 tracked rows** (IDs 1–82; IDs 10-12/14/17
are gaps, IDs 15/18/23/24/25 are duplicated): 66 `Applied`, 6 `Discarded`, 4
`Evaluated`, 1 `Rejected`, 1 `Responded`. Submission channels were a mix of:

- **Email with tailored body + CV PDF attached** (the bulk) — sent via the
  batch SMTP scripts
- **ATS form submissions** — Greenhouse (mthree, Decisions), Ninja Forms (Arrk),
  Keka (Wohlig), Google Forms (Wyreflow), MS Forms (SequelString)
- **Recruiter follow-ups** — reply scripts for 1Accord, DP Info

Real pipeline outcomes: DP Info confirmed an interview then ghosted; 1Accord's
Mahadev Dalvi reached out re: IoT Cloud Engineer; Miko.ai's recruiter responded;
bounced addresses (AREA REALTY, FamPay, Go India Stocks) were caught and the
applications marked `Discarded` instead of silently lost.

## Stage 0 — Search (where the JDs came from)

The job pool came from **three complementary channels**:

1. **Indian job boards** (pre-filtered by location in `portals.yml` `job_boards:`):
   Tier 1 always scanned — Naukri Mumbai, Indeed India Mumbai, Shine Mumbai,
   Foundit Mumbai, TimesJobs Mumbai, Hirist Mumbai, Instahyre Mumbai,
   Internshala Mumbai. Tier 2 (`expand_on_rerun`) — Cutshort, apna, iimjobs,
   LinkedIn India Mumbai, Glassdoor India Mumbai, Freshersworld.
2. **Company ATS boards** — zero-token public APIs and Playwright scraping of
   Greenhouse / Lever / Ashby / Workable. `data/users/*/data/scan-history.tsv`
   (5,619 rows) breaks down: 2,818 greenhouse, 1,831 ashby, 339 lever, plus
   `-api` sources and 14 workable, 8 websearch. India-relevant slugs include
   Paytm, Meesho, Razorpay, Postman (Lever/Greenhouse); Groww, Zomato, etc.
3. **WebSearch / Playwright** for career pages without an ATS (the `scan_method:
   websearch` entries in `portals.yml`), plus manual URL pasting into
   `data/pipeline.md`.

**The reusable rule:** scan broadly and cheaply (ATS APIs are free), let the
per-user profile do the title/location/salary filtering server-side, and never
hardcode a user's roles/comp into the portal config. Per-user filters live in
`data/users/<id>/config/profile.yml`.

## Stage 1 — Evaluate (the A-G engine)

Each URL was evaluated by a **headless worker** using `batch/batch-prompt.md`
as its system prompt, orchestrated by `batch/batch-runner.sh`.

Orchestration (`batch-runner.sh`):
- Reads `batch-input.tsv` (id, url, source, notes) and `batch-state.tsv` for
  resumability (`pending/processing/completed/failed/skipped/rate_limited/
  paused_rate_limit`).
- Reserves a 3-digit report number per offer before the worker starts.
- Launches `claude -p --dangerously-skip-permissions --strict-mcp-config
  --append-system-prompt-file <resolved-prompt>` per offer. Model resolved from
  `spend_tier` in `config/profile.yml`: `economy → haiku-4-5`, `standard →
  sonnet-4-6`, `premium → opus-4-8`.
- **Pre-screen gate (standard/premium only):** a cheap economy-model pass first;
  obvious mismatches (domain/seniority/location/visa) are marked `skipped` in
  state AND appended to `batch/logs/discard.log` as an auditable one-line
  record — pre-filtering is never a silent black box.
- Rate-limit/session-limit handling: `rate_limited` rows retry after a sleep;
  `paused_rate_limit` pauses the whole batch and resumes only via
  `--resume-paused`. Stale-lock recovery, PID lock file, `--min-score`,
  `--skip-pdf`, `--parallel N`, `--retry-failed` all supported.

Worker output (`batch-prompt.md`), in order:
1. **Step 0 — Archetype detection** (the adaptive-framing core): classify the
   role into the candidate's archetype axes (e.g. Full Stack / Software /
   Frontend / Backend). "The truth stays the same; the emphasis changes."
2. **Block A — Role Summary:** archetype, domain, function, seniority, work
   mode, team size, TL;DR.
3. **Block B — CV Match:** map every JD requirement to exact evidence from
   `cv.md` / `article-digest.md`; classify gaps as hard blocker vs nice-to-have,
   give concrete mitigation. **Never invent metrics.**
4. **Block C — Level & Strategy:** JD seniority vs candidate's natural level,
   how to sell without lying, downlevel response.
5. **Block D — Compensation & Demand:** WebSearch salary bands + company hiring
   signals. **Company-type classification is mandatory** (public tech / growth
   startup / early-stage / enterprise / agency / SMB / sales / recruiter / gov /
   OSS) which drives a **comp-reliability tier** (High/Medium/Low/Unknown). If
   no advertised salary, collapse to exactly two lines. When advertised comp
   exists, split into advertised range / guaranteed base / variable components /
   expected stable cash / non-cash benefits, and produce 3–6 HR verification
   questions. Treat "up to", "OTE", "comprehensive salary", allowances as
   low-reliability unless base is separated.
6. **Block E — Personalization Plan:** table of per-section CV changes with a
   "why".
7. **Block F — Interview Plan:** 6–10 STAR+R stories mapped to JD requirements,
   one case study, red-flag questions.
8. **Block G — Posting Legitimacy:** High Confidence / Proceed with Caution /
   Suspicious using JD specificity, salary transparency, boilerplate ratio,
   layoff signals, scan-history prior appearance, scam language. Default to
   `Proceed with Caution` on thin evidence.
9. **Global score table:** CV match / North Star alignment / Compensation /
   Culture & working model / Red flags → **Global X.X/5**.
10. **Machine Summary YAML** (exact field names, consumed by scripts):
    `company, role, score, legitimacy_tier, archetype, final_decision
    (Apply|Consider|Research first|Skip), hard_stops, soft_gaps, top_strengths,
    risk_level, confidence, next_action, discard_reasons, via,
    company_confidential, advertised_comp`. `advertised_comp` is the JD's own
    verbatim figure or `null` — never an estimate.
11. **Report file** saved to `reports/{NUM}-{company-slug}-{date}.md` with the
    machine summary + all A-G blocks + extracted keywords.

Gates that decide what happens next:
- **PDF gate:** `auto_pdf_score_threshold` in `config/profile.yml` (default
  `3.0`). `>= threshold` → tailored ATS-optimized CV PDF via
  `generate-pdf.mjs`; below → no PDF, `❌` in tracker.
- **Recommendation rule (AGENTS.md):** below **4.0/5 → recommend against
  applying**. Quality over quantity.

## Stage 2 — Track

Each worker writes **one TSV line** to `batch/tracker-additions/{id}.tsv`, 9
tab-separated columns **in this order (status BEFORE score)**:
`num\tdate\tcompany\trole\tstatus\tscore/5\tpdf_emoji\t[report](link)\tnotes`.

- `num` = reserved report number; `status` from `templates/states.yml`
  (`Evaluated → Applied → Responded → Interview → Offer / Rejected /
  Discarded`; `SKIP` for rejected postings).
- Optional labeled `via={Agency}` for recruiter-sourced offers; `?` as company
  when the end employer is unknown.
- `merge-tracker.mjs` converts column order (score before status in
  `applications.md`), dedupes by company+role fuzzy match, applies in-place
  updates when a re-evaluation scores higher, and moves merged TSVs to
  `tracker-additions/merged/`.
- `reconcile-pipeline.mjs` moves completed/skipped offers out of the
  `data/pipeline.md` "Pendientes" inbox so they are never re-evaluated;
  `verify-pipeline.mjs` checks integrity at the end of each run.

## Stage 3 — Submit (email, the workhorse)

The bulk of the 81 applications were **tailored emails with the generic CV PDF
attached**, sent through the batch SMTP scripts:
`batch/send-0714-batch-2.mjs`, `batch/send-0715-batch.mjs`,
`batch/send-0725-batch.mjs`.

Mechanics (all three scripts share the same shape):
- Raw SMTP over TLS (`tls.connect('smtp.gmail.com', 465)`), `AUTH LOGIN` with
  a Gmail **app password** passed as CLI args (`node send-XXX.mjs <email>
  <app-password>`) — credentials are never stored in files.
- Each email: hardcoded `EMAILS` array of `{company, to, subject, body}`,
  multipart/mixed with `output/cv-jayesh-generic.pdf` (now served as the user's
  exact resume — `output/current-resume.pdf`, see `Playwright Automation.md`) attached as
  `Jayesh_Singh_CV.pdf` (76-char base64 folding), UTF-8 Q-encoded subject,
  1s delay between sends, per-send success/failure reporting and a final
  `=== Done: N sent, M failed ===` summary.
- Bounces surface in the send result and the application is updated
  (e.g. AREA REALTY → `Discarded` with the SMTP 550 reason in Notes).

**The body template that worked** (reconstructable from the EMAILS payloads):
1. Salutation to the hiring team.
2. Opening: role + "I am a Full Stack Developer with X/Y/Z" — name the JD's own
   stack keywords back.
3. Evidence paragraph: 1–2 flagship projects with metrics (e.g. FairPay
   Solution — 700+ clients, ₹50Cr+ debt resolved; GeoTrack — ~40% API cost cut;
   Llama 3.3 70B deployment).
4. "Key highlights" bullet list: stack, AI/ML, cloud/devops, education.
5. **Location line** — always present and commute-aware ("based in Kalyan, Navi
   Mumbai/Thane easily commutable", or "available for WFH including US shift").
6. "My resume is attached." + sign-off with phone number.
- Subject convention: `Application for {role}`.
- `to` address comes from the posting/careers page/JD (e.g.
  careers@unicoconnect.com, info@dpinfosystem.in, contact@metnmat.com).

**The reusable rule:** the user's exact resume (`output/current-resume.pdf`,
  byte-for-byte copy of the resume they provided) is the single attachment base,
  while the *email body* carries the tailoring per company — cheap to produce at
  scale, still personalized.

## Stage 4 — Follow up

`batch/reply-1accord.mjs` and `batch/send-dpinfo-link-request.mjs` are the
follow-up pattern: same SMTP socket, plain-text single email, referencing the
prior thread ("Re: CV Submission...", "Just checking in — I have the interview
scheduled..."). Follow-ups target recruiter replies and scheduled interviews;
cadence is tracked in `data/follow-ups.md`.

## Why it worked — the transferable logic

1. **Volume + cheap pre-screen** — scan thousands for free (ATS APIs), kill
   obvious mismatches on the economy model before spending real tokens.
2. **Evidence-only matching** — nothing fabricated; everything mapped to
   `cv.md`/`article-digest.md`, with explicit gap mitigation.
3. **Adaptive framing** — one CV + archetype-aware emphasis instead of
   rewriting everything.
4. **Hard filters enforced** — comp floor (3 LPA), location policy
   (Mumbai/Thane/Navi Mumbai/Kalyan only; never Bangalore/Pune), remote/hybrid
   preferred. These live in the user layer (`modes/_profile.md`,
   `modes/_custom.md`), not the system.
5. **Comp reliability classification** — "₹20k/mo → up to 11 LPA" is read as a
   signal, not a promise.
6. **Legitimacy + bounce handling** — suspicious or bouncing targets become
   `Discarded`, not silent failures.
7. **Tailored-but-template emails** — per-company body with commute/availability
   line + the generic CV attached.
8. **HITL at the only irreversible step** — the batch evaluates and drafts
   automatically; the human runs the send script with the app password.
9. **Full state + audit trail** — `batch-state.tsv`, `discard.log`, per-offer
   logs, resumability, dedup merge.

## Replicating for any user

- The pipeline reads everything from the **user layer**, so a new user only
  needs: `config/profile.yml` (roles, comp, location, `spend_tier`,
  `auto_pdf_score_threshold`, `language.output`), `modes/_profile.md`
  (archetype axes + adaptive framing + comp targets), `modes/_custom.md`
  (house rules: comp floor, location policy, off-limits), `cv.md` +
  `article-digest.md` (proof points). No system file changes required.
- In the bridge app, per-user state already keys everything by
  `X-User-Id: <email>` (`data/users/<id>/...`), and `portals.yml` stays
  user-agnostic — the scanner applies each user's `profile.yml` filters
  server-side.
- To run the same batch for a new user: populate `batch-input.tsv` with their
  URLs, point `config/profile.yml` at their profile, run
  `./batch/batch-runner.sh` (dry-run first), review, then send via a copy of
  the SMTP script with their email + app password.

## Related files

- `batch/batch-runner.sh` — orchestrator (pre-screen gate, state machine, model
  routing, rate-limit handling)
- `batch/batch-prompt.md` — worker system prompt (A-G blocks, machine summary,
  PDF/tracker JSON contracts)
- `batch/send-0714-batch-2.mjs`, `batch/send-0715-batch.mjs`,
  `batch/send-0725-batch.mjs` — email submission scripts
- `batch/reply-1accord.mjs`, `batch/send-dpinfo-link-request.mjs` — follow-ups
- `batch/tracker-additions/merged/*.tsv` — 85 merged tracker files covering 80
  unique report numbers (some numbers have duplicate files, e.g. 023-red-arc +
  023-the-red-arc; numbers 010/011/012/014/017 were reserved but never produced
  a line)
- `reports/{NUM}-{slug}-{date}.md` — the 31 retained evaluation reports
- `merge-tracker.mjs`, `reconcile-pipeline.mjs`, `verify-pipeline.mjs`,
  `reserve-report-num.mjs`
- `modes/batch.md`, `modes/_shared.md` (spend-tier table), `modes/_profile.md`,
  `modes/_custom.md`
- `portals.yml` (`job_boards:` India tier 1/2; ATS API entries)
- `data/applications.md` (result), `data/pipeline.md` (inbox),
  `data/users/*/data/scan-history.tsv` (search corpus)

## Out of scope

- Cloudflare-walled portal logins (Internshala/Shine) and the stealth/patchright
  workaround live in [[Playwright Automation]].
- The ATS form-fill submission path lives in [[Auto-fill Pipeline]].
- Email IMAP / reply classification lives in [[IMAP Email]].
- Evaluation scoring rules shared with interactive mode live in
  [[Evaluation Engine]].
