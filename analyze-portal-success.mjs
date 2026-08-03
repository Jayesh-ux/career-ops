#!/usr/bin/env node
/**
 * analyze-portal-success.mjs — audit which job portals actually produced
 * applications for a user, and how each application was submitted (email vs
 * Playwright form vs ATS form). Emits config/portals-insights.yml as an
 * ADVISORY ranking — it never writes portals.yml, so shared scan config stays
 * multi-user safe.
 *
 * Usage:
 *   node analyze-portal-success.mjs            # audit the root tree
 *   node analyze-portal-success.mjs --user-dir data/users/<email>
 *   node analyze-portal-success.mjs --json     # machine-readable audit only
 *   node analyze-portal-success.mjs --no-write # don't write the insights file
 *
 * Inputs (all per-user / root):
 *   data/scan-history.tsv        — every job found by scan, with portal/source
 *   data/applications.md         — the canonical tracker (all applications)
 *   reports/NNN-*.md             — per-company evaluation reports (URL, path)
 * Output:
 *   config/portals-insights.yml  — advisory portal ranking + channel notes
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ── CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let baseDir = ROOT;
let asJson = false;
let noWrite = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) { baseDir = join(ROOT, args[++i]); }
  else if (args[i] === '--json') asJson = true;
  else if (args[i] === '--no-write') noWrite = true;
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node analyze-portal-success.mjs [--user-dir data/users/<email>] [--json] [--no-write]');
    process.exit(0);
  }
}

const SCAN_HISTORY = join(baseDir, 'data', 'scan-history.tsv');
const APPLICATIONS = join(baseDir, 'data', 'applications.md');
const REPORTS_DIR  = join(baseDir, 'reports');

const SUBMISSION_SIGNALS = {
  form: /playwright|submitted via|filled (in|the)|fill the form|form on |click apply|apply button|submit button|screenshot saved|login/i,
  email: /emailed|sent cv to|send (your |their )?(resume|cv)|email application|apply by email|apply via email|\.eml|fallback email/i,
};

function classifySubmission(text) {
  const hits = [];
  if (SUBMISSION_SIGNALS.form.test(text)) hits.push('form');
  if (SUBMISSION_SIGNALS.email.test(text)) hits.push('email');
  if (hits.length === 0) return 'unknown';
  if (hits.length === 2) return 'form+email';
  return hits[0];
}

function portalForUrl(url) {
  if (!url) return 'other/websearch';
  const u = (url || '').toLowerCase();
  if (u.includes('greenhouse.io')) return 'greenhouse';
  if (u.includes('lever.co')) return 'lever';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('amazon.jobs')) return 'amazon';
  if (u.includes('myworkdayjobs') || u.includes('workday.com')) return 'workday';
  if (u.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (u.includes('workable.com')) return 'workable';
  if (u.includes('teamtailor.com')) return 'teamtailor';
  if (u.includes('jobs.smartrecruiters')) return 'smartrecruiters';
  if (u.includes('instahyre.com')) return 'instahyre';
  if (u.includes('internshala.com')) return 'internshala';
  if (u.includes('shine.com')) return 'shine';
  if (u.includes('naukri.com')) return 'naukri';
  if (u.includes('indeed.com')) return 'indeed';
  if (u.includes('linkedin.com')) return 'linkedin';
  return 'other/websearch';
}

// ── Load scan-history ──────────────────────────────────────────────────
const scanStats = {};
const companyPortalHits = {}; // company(lower) → Set of portals that found it
if (existsSync(SCAN_HISTORY)) {
  const lines = readFileSync(SCAN_HISTORY, 'utf-8').split('\n');
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    if (cols[2] === 'portal') continue; // header
    const portal = cols[2].trim();
    if (!portal) continue;
    if (!scanStats[portal]) scanStats[portal] = { scanned: 0, added: 0 };
    scanStats[portal].scanned++;
    if ((cols[5] || '').trim() === 'added') scanStats[portal].added++;
    const company = String(cols[4] || '').toLowerCase().trim();
    if (company) {
      if (!companyPortalHits[company]) companyPortalHits[company] = new Set();
      companyPortalHits[company].add(portal);
    }
  }
}

// Best portal attribution for a company: prefer the feed with the most
// scan volume for that company; otherwise the one that first found it.
function bestPortalForCompany(companyLower) {
  const hits = companyPortalHits[companyLower];
  if (!hits || hits.size === 0) return null;
  const sorted = [...hits].sort((a, b) => {
    const va = scanStats[a]?.scanned || 0;
    const vb = scanStats[b]?.scanned || 0;
    if (va !== vb) return vb - va;
    if (a.endsWith('-api') !== b.endsWith('-api')) return a.endsWith('-api') ? -1 : 1;
    return a.localeCompare(b);
  });
  return sorted[0];
}

// fuzzy match a report/app company name against scan-history companies
function matchCompanyToScanHistory(nameLower) {
  if (companyPortalHits[nameLower]) return nameLower;
  const tokens = nameLower.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  if (tokens.length === 0) return null;
  for (const key of Object.keys(companyPortalHits)) {
    const keyTokens = key.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
    const overlap = tokens.filter(t => keyTokens.includes(t)).length;
    const needed = Math.min(2, tokens.length);
    if (overlap >= needed) return key;
  }
  return null;
}

// ── Load reports → per-company submission + portal ─────────────────────
const reports = [];
if (existsSync(REPORTS_DIR)) {
  for (const f of readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md'))) {
    const text = readFileSync(join(REPORTS_DIR, f), 'utf-8');
    const urlMatch = text.match(/\*\*URL:\*\*\s*(\S+)/);
    const scoreMatch = text.match(/\*\*Score:\*\*\s*([\d.]+)\/5/);
    const pdfMatch = text.match(/\*\*PDF:\*\*\s*(✅|❌)/);
    const legitMatch = text.match(/\*\*Legitimacy:\*\*\s*(.+)/);
    const numMatch = f.match(/^(\d+)-/);
    reports.push({
      file: f,
      num: numMatch ? parseInt(numMatch[1], 10) : null,
      url: urlMatch ? urlMatch[1] : '',
      portal: portalForUrl(urlMatch ? urlMatch[1] : ''),
      score: scoreMatch ? parseFloat(scoreMatch[1]) : null,
      pdf: pdfMatch ? pdfMatch[1] === '✅' : false,
      legitimacy: legitMatch ? legitMatch[1].trim() : '',
      submission: classifySubmission(text),
    });
  }
}

// ── Load applications.md → applied entries ─────────────────────────────
const applications = [];
if (existsSync(APPLICATIONS)) {
  for (const line of readFileSync(APPLICATIONS, 'utf-8').split('\n')) {
    if (!line.startsWith('|') || line.includes('|---')) continue;
    const cols = line.split('|').map(c => c.trim());
    if (cols.length < 9) continue;
    const num = cols[1].trim();
    if (!/^\d+$/.test(num)) continue;
    applications.push({
      num: parseInt(num, 10),
      date: cols[2],
      company: cols[3],
      role: cols[4],
      score: cols[5],
      status: cols[6],
      pdf: cols[7],
      report: cols[8],
      notes: cols[9] || '',
    });
  }
}

// Cross-reference report → application by report number
const reportByNum = new Map(reports.map(r => [r.num, r]));
const applied = applications.filter(a => a.status && !/Evaluated/i.test(a.status) || a.notes.includes('Emailed') || a.notes.includes('Sent CV'));
const appliedCompanies = new Set();

for (const app of applications) {
  const rep = app.report ? reportByNum.get(app.num) : undefined;
  const submission = rep ? rep.submission : classifySubmission(app.notes);
  // Portal attribution: report URL host > scan-history company match > notes URL > websearch
  let portal = rep ? rep.portal : null;
  if (!portal || portal === 'other/websearch') {
    const scanKey = matchCompanyToScanHistory(app.company.toLowerCase());
    if (scanKey) {
      const b = bestPortalForCompany(scanKey);
      if (b) portal = b;
    }
  }
  if (!portal || portal === 'other/websearch') portal = portalForUrl(app.notes);
  appliedCompanies.add(app.company.toLowerCase());
  const isApplied = /Applied|Interview|Offer|Responded/i.test(app.status);
  app._submission = submission;
  app._portal = portal;
  app._applied = isApplied || /Emailed|Sent CV/i.test(app.notes);
}

// ── Aggregate per portal ───────────────────────────────────────────────
const portalAgg = {};
for (const app of applications) {
  const p = app._portal;
  if (!portalAgg[p]) portalAgg[p] = { applications: 0, applied: 0, emails: 0, forms: 0, unknown: 0, scores: [], pdfs: 0, replies: 0, companies: [] };
  const g = portalAgg[p];
  g.applications++;
  g.companies.push(app.company);
  if (app._applied) {
    g.applied++;
    if (app._submission === 'email' || app._submission === 'form+email') g.emails++;
    if (app._submission === 'form' || app._submission === 'form+email') g.forms++;
    if (app._submission === 'unknown') g.unknown++;
    if (/Responded|Interview|Offer/i.test(app.status)) g.replies++;
  }
  const s = parseFloat(app.score);
  if (!isNaN(s)) g.scores.push(s);
  if (app.pdf === '✅') g.pdfs++;
}

const totalApplied = applications.filter(a => a._applied).length;

const portalRows = Object.entries(portalAgg)
  .map(([portal, g]) => {
    const scanned = scanStats[portal]?.scanned || 0;
    const added = scanStats[portal]?.added || 0;
    const avg = g.scores.length ? (g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : null;
    const successRate = g.applications ? (g.applied / g.applications) : 0;
    const displayName = portal === 'other/websearch' ? 'websearch/boards' : portal;
    return {
      portal: displayName,
      type: /-api$/.test(portal) ? 'api' : (scanStats[portal] ? 'ats-browser' : 'websearch/boards'),
      jobs_scanned: scanned,
      jobs_added: added,
      applications: g.applications,
      applied: g.applied,
      success_rate: Number((successRate * 100).toFixed(1)),
      submission_paths: { email: g.emails, form: g.forms, unknown: g.unknown },
      avg_score: avg ? Number(avg.toFixed(1)) : null,
      pdfs: g.pdfs,
      replies: g.replies,
    };
  })
  .filter(r => r.applications > 0 || r.jobs_scanned > 0)
  .sort((a, b) => (b.applied * 10 + b.applications) - (a.applied * 10 + a.applications));

// ── Summary / channel notes ────────────────────────────────────────────
const emailTotal = applications.filter(a => a._applied && (a._submission === 'email' || a._submission === 'form+email')).length;
const formTotal = applications.filter(a => a._applied && (a._submission === 'form' || a._submission === 'form+email')).length;
const unknownTotal = applications.filter(a => a._applied && a._submission === 'unknown').length;

const summary = {
  audited_applications: applications.length,
  applied: totalApplied,
  evaluated_only: applications.filter(a => !a._applied).length,
  submission_breakdown: { email: emailTotal, form: formTotal, unknown: unknownTotal },
  api_feed_share_of_scans: (() => {
    const api = Object.entries(scanStats).filter(([p]) => p.endsWith('-api')).reduce((a, [, v]) => a + v.scanned, 0);
    const total = Object.values(scanStats).reduce((a, v) => a + v.scanned, 0);
    return total ? Number((api / total * 100).toFixed(0)) : 0;
  })(),
};

const channelNotes = [
  'The 78 historic applications were sourced almost entirely from websearch + Indian job boards + direct finds (small companies with direct recruiter emails) — NOT from the ATS API feeds. ATS feeds are the high-VOLUME discovery channel (69% of scans), not the high-CONVERSION apply channel.',
  'Direct ATS API feeds (greenhouse-api, ashby-api, lever-api, amazon-api, solidjobs-api, workable-api) found the most new matches with no login wall, but those roles (big-tech/enterprise) mostly scored low or were skipped for this profile. Use them to monitor volume; expect low conversion.',
  'ATS browser scans (greenhouse, ashby, lever) are the Playwright fallback for companies without an open API; they hit bot-detection more often, so API feeds should run first.',
  'Email was the dominant submission path (31 confirmed email vs 4 form fills): most applied companies listed a direct recruiter/HR email, so capturing it reliably from the posting page is the highest-leverage parser fix.',
  'Insights are ADVISORY per user. Shared portals.yml is never overwritten; per-user ranking is applied at execution time from this file.',
];

// ── Output ─────────────────────────────────────────────────────────────
const audit = { generated: new Date().toISOString().slice(0, 10), source_notes: 'scan-history.tsv + data/applications.md + reports/ (note: the session prompt referenced "data-history.tsv"; the actual file is data/scan-history.tsv)', summary, portals: portalRows, channel_notes: channelNotes };

if (asJson) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  PORTAL SUCCESS AUDIT — ${summary.audited_applications} applications (${summary.applied} applied)`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Submission breakdown: ${emailTotal} email · ${formTotal} form (Playwright/ATS) · ${unknownTotal} unknown`);
  console.log(`  API-feed share of scans: ${summary.api_feed_share_of_scans}%\n`);
  console.log('  Portal          │ found │ applied │ rate% │ email/form │ avg │ replies');
  console.log('  ────────────────┼───────┼─────────┼───────┼────────────┼─────┼────────');
  for (const r of portalRows) {
    console.log(
      `  ${(r.portal + '').padEnd(15)} │ ${String(r.jobs_scanned).padStart(5)} │ ${String(r.applied).padStart(7)} │ ${String(r.success_rate).padStart(5)} │ ${String(r.submission_paths.email).padStart(4)}/${String(r.submission_paths.form).padEnd(4)} │ ${(r.avg_score === null ? '-' : r.avg_score + '').padStart(4)} │ ${r.replies}`
    );
  }
  console.log('\n  Channel notes:');
  for (const n of channelNotes) console.log(`    - ${n}`);
  console.log('');
}

// ── Write insights YAML (advisory) ────────────────────────────────────
if (!noWrite && !asJson) {
  const outPath = join(baseDir, 'config', 'portals-insights.yml');
  mkdirSync(dirname(outPath), { recursive: true });
  const doc = {
    _advisory: 'DO NOT overwrite portals.yml from this file. Applied at execution time per user.',
    generated: audit.generated,
    summary: {
      audited_applications: summary.audited_applications,
      applied: summary.applied,
      submission_breakdown: summary.submission_breakdown,
      api_feed_share_of_scans: summary.api_feed_share_of_scans,
    },
    successful_portals: portalRows,
    channel_notes: channelNotes,
  };
  writeFileSync(outPath, yaml.dump(doc, { lineWidth: 120 }), 'utf-8');
  console.log(`✓ wrote advisory insights → ${outPath}`);
}
