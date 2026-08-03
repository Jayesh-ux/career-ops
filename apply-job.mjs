#!/usr/bin/env node
/**
 * apply-job.mjs — Playwright-based job application via CLI.
 *
 * Modes:
 *   --extract (default): Opens Chrome, extracts form fields + generates answers, closes
 *   --fill: Opens Chrome, fills form with provided answers, attaches CV, never submits
 *
 * Usage:
 *   node apply-job.mjs <url> [--user-dir <dir>] [--headless]
 *   node apply-job.mjs <url> --fill --answers-json <path> [--company <name>] [--user-dir <dir>]
 *
 * Output: JSON to stdout.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { seedGoogleCookies, stealthInitScript } from './seed-cookies.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Termux/Android compatibility: playwright-core computes its browser cache
// directory at import time and throws "Unsupported platform: android" on
// Termux's node (process.platform === 'android'). Force 'linux' so the import
// succeeds, and point the registry at an existing ms-playwright dir so no
// on-device browser download is needed.
if (process.platform === 'android') {
  Object.defineProperty(process, 'platform', { value: 'linux' });
}
// Termux/proot maps paths like /root/.cache through /.l2s/, which breaks
// Chromium: it derives its asset dir from /proc/self/exe (reported as
// "/.l2s/..."), then cannot find icudtl.dat, *.pak or snapshot files beside
// it. Browsers on a clean path such as /opt launch correctly, so always
// prefer a clean install and, when only an l2s-affected copy exists, copy
// the browsers there once (idempotent, non-destructive).
const CLEAN_BROWSERS_DIR = '/opt/ms-playwright';
const hasBrowser = (dir) => {
  try { return readdirSync(dir).some((e) => e.startsWith('chromium')); }
  catch { return false; }
};
const l2sCandidates = [
  join(process.env.HOME || '', '.cache', 'ms-playwright'),
  '/root/.cache/ms-playwright',
  '/data/data/com.termux/files/home/.cache/ms-playwright',
];
let cleanReady = hasBrowser(CLEAN_BROWSERS_DIR);
if (!cleanReady) {
  const src = l2sCandidates.find(hasBrowser);
  if (src) {
    try {
      mkdirSync(CLEAN_BROWSERS_DIR, { recursive: true });
      for (const e of readdirSync(src)) {
        if (e.startsWith('chromium') && !existsSync(join(CLEAN_BROWSERS_DIR, e))) {
          cpSync(join(src, e), join(CLEAN_BROWSERS_DIR, e), { recursive: true });
        }
      }
    } catch { /* non-fatal: fall back to the source location */ }
  }
  cleanReady = hasBrowser(CLEAN_BROWSERS_DIR);
}
if (cleanReady) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = CLEAN_BROWSERS_DIR;
} else if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const src = l2sCandidates.find(hasBrowser);
  if (src) process.env.PLAYWRIGHT_BROWSERS_PATH = src;
}

// Parse args
const args = process.argv.slice(2);
let userDir = process.env.CAREER_OPS || __dirname;
let headless = false;
let jobUrl = '';
let fillMode = false;
let answersJsonPath = '';
let companyOverride = '';
let stealthMode = false;
let manualGuideMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
  if (args[i] === '--headless') headless = true;
  if (args[i] === '--fill') fillMode = true;
  if (args[i] === '--answers-json' && args[i + 1]) answersJsonPath = args[++i];
  if (args[i] === '--company' && args[i + 1]) companyOverride = args[++i];
  if (args[i] === '--stealth') stealthMode = true;
  if (args[i] === '--manual-guide') manualGuideMode = true;
  if (args[i].startsWith('http')) jobUrl = args[i];
}

// If a headed browser is requested but no display is available, fall back to
// headless so auto-fill still works on servers/VMs without an X server.
if (!headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  headless = true;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux i686; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── ATS Platform Detection ────────────────────────────────────────────

const ATS_PLATFORMS = [
  { name: 'Greenhouse',  patterns: ['boards.greenhouse.io', 'greenhouse.io', 'grnh.se'] },
  { name: 'Keka',        patterns: ['keka.com', 'keka.'] },
  { name: 'Workday',     patterns: ['myworkdayjobs.com', 'workday.com', 'wd5.myworkdayjobs.com'] },
  { name: 'Lever',       patterns: ['lever.co', 'hire.lever.co'] },
  { name: 'Workable',    patterns: ['workable.com', 'apply.workable.com'] },
  { name: 'BambooHR',    patterns: ['bamboohr.com', 'apply.bamboohr.com'] },
  { name: 'SmartRecruiters', patterns: ['smartrecruiters.com', 'jobs.smartrecruiters.com'] },
  { name: 'JazzHR',      patterns: ['jazzhr.com', 'apply.jazzhr.com'] },
  { name: 'iCIMS',       patterns: ['icims.com', 'jobs.icims.com'] },
  { name: 'Taleo',       patterns: ['taleo.net', 'oracle.com/taleo'] },
  { name: 'SuccessFactors', patterns: ['successfactors.com', 'sap.com/careers'] },
  { name: 'Ashby',       patterns: ['ashbyhq.com', 'jobs.ashbyhq.com'] },
  { name: 'Pinpoint',    patterns: ['pinpointhq.com', 'jobs.pinpointhq.com'] },
  { name: 'BreezyHR',    patterns: ['breezy.hr', 'breezyhr.com'] },
  { name: 'Recruitee',   patterns: ['recruitee.com', 'apply.recruitee.com'] },
  { name: 'Teamtailor',  patterns: ['teamtailor.com', 'jobs.teamtailor.com'] },
  { name: 'Manatal',     patterns: ['manatal.com', 'careers.manatal.com'] },
  { name: 'Freshteam',   patterns: ['freshteam.com', 'recruit.freshteam.com'] },
  { name: 'Zoho Recruit', patterns: ['zohorecruit.com', 'recruit.zoho.com'] },
  { name: 'Internshala', patterns: ['internshala.com'] },
  { name: 'Naukri',      patterns: ['naukri.com', 'naukri.com/recruiter'] },
  { name: 'LinkedIn',    patterns: ['linkedin.com/jobs'] },
  { name: 'Indeed',      patterns: ['indeed.com', 'indeed.'], skipScrape: true },
];

function detectAtsType(url) {
  const u = (url || '').toLowerCase();
  for (const ats of ATS_PLATFORMS) {
    for (const p of ats.patterns) {
      if (u.includes(p)) return ats.name;
    }
  }
  return null;
}

const BOT_DETECTION_PATTERNS = {
  // Block-page text patterns. Applied to the VISIBLE page text only — the raw
  // HTML often embeds CSS/JS containing words like "captcha" (e.g. Ashby's
  // hidden .grecaptcha-badge rule) which would otherwise false-positive.
  blockText: [
    /verify.*you.*are.*human|verify.*human|please.*complete.*captcha|complete.*security.*check/i,
    /access.*denied|access.*blocked|request.*blocked|your.*access.*has.*been/i,
    /automated.*(access|traffic|requests?)|unusual.*traffic|bot.?request/i,
    /checking.*your.*browser|verifying.*your.*browser|waiting.*for.*challenges\.cloudflare/i,
    /perimeterx|px\.js|blocked.*perimeter/i,
    /datadome|captcha\.datadome/i,
    /akamai.*(bot|challenge)|bm_sz/i,
    /distil|distil_|bot.*block|blocked.*bot/i,
    /sorry.*unable.*(complete|process).*request/i,
  ],
  cookies: ['cf_clearance', '_cfduid', '_px3', '_px2', 'bm_sz', 'ak_bmsc', 'datadome'],
};

async function checkBotCookies(page) {
  try {
    // Bot cookies (cf_clearance, bm_sz, ...) are site-scoped. A stale cookie
    // persisted from a DIFFERENT site — e.g. an Internshala challenge cookie
    // left in the reusable Playwright profile — must not block filling an
    // open company career page (Greenhouse/Ashby/Lever). Only flag a cookie
    // whose domain belongs to the page we are actually on.
    let host = '';
    try { host = new URL(page.url()).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* keep '' */ }
    const cookies = await page.context().cookies();
    const found = cookies.filter(c => {
      if (!BOT_DETECTION_PATTERNS.cookies.includes(c.name)) return false;
      const dom = String(c.domain || '').toLowerCase().replace(/^\./, '');
      if (!dom || !host) return true; // host-only cookie for the current page
      return host === dom || host.endsWith('.' + dom) || dom.endsWith('.' + host);
    });
    return found.length > 0 ? found.map(c => c.name) : [];
  } catch {
    return [];
  }
}

// Detect an actual interactive challenge widget in the DOM (Turnstile,
// reCAPTCHA, hCaptcha, Cloudflare container). Returns a label or null.
async function detectBotWidget(page) {
  try {
    return await page.evaluate(() => {
      const has = (sel) => !!document.querySelector(sel);
      if (has('iframe[src*="challenges.cloudflare.com"]') || has('[data-turnstile-sitekey]')) return 'turnstile';
      if (has('#cf-chl-container') || has('#challenge-container') || has('.cf-challenge-running')) return 'cloudflare';
      if (has('.g-recaptcha') || has('iframe[src*="recaptcha/api/anchor"]')) return 'recaptcha';
      if (has('.h-captcha') || has('iframe[src*="hcaptcha.com/captcha"]')) return 'hcaptcha';
      return null;
    });
  } catch {
    return null;
  }
}

// ── Phase 3: Hybrid Field Mapping (ATS Known Patterns) ───────────────

const ATS_KNOWN_PATTERNS = {
  Greenhouse: {
    mapping: {
      'first_name': 'candidate.first_name',
      'last_name': 'candidate.last_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'location': 'candidate.location',
      'linkedin': 'candidate.linkedin',
      'github': 'candidate.github',
      'portfolio': 'candidate.portfolio_url',
      'resume': 'cv',
      'cover_letter': 'cover_letter',
    },
    notes: 'Greenhouse uses dynamic SPA forms. Fields are injected via JS. Direct apply URL format: https://boards.greenhouse.io/{company}/jobs/{id}',
    fieldExamples: ['first_name', 'last_name', 'email', 'phone', 'location', 'linkedin_profile_url', 'github_url', 'resume', 'cover_letter'],
  },
  Keka: {
    mapping: {
      'firstName': 'candidate.first_name',
      'lastName': 'candidate.last_name',
      'email': 'candidate.email',
      'mobile': 'candidate.phone',
      'phone': 'candidate.phone',
      'currentCity': 'candidate.location',
      'linkedinProfile': 'candidate.linkedin',
      'totalExperience': 'candidate.experience_years',
      'currentCTC': 'compensation.target_range',
      'expectedCTC': 'compensation.target_range',
    },
    notes: 'Keka portals often require account creation before applying. Fields are in multi-step wizard.',
    fieldExamples: ['firstName', 'lastName', 'email', 'mobile', 'currentCity', 'totalExperience', 'currentCTC', 'expectedCTC', 'linkedinProfile'],
  },
  Workday: {
    mapping: {
      'name': 'candidate.first_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'address': 'candidate.location',
      'resume': 'cv',
    },
    notes: 'Workday has extremely complex nested iframes and JS rendering. Often requires manual fill. Direct apply URL is unique per job.',
    fieldExamples: ['name', 'email', 'phone', 'address', 'resume'],
  },
  Lever: {
    mapping: {
      'name': 'candidate.first_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'links[linkedin]': 'candidate.linkedin',
      'links[github]': 'candidate.github',
      'links[portfolio]': 'candidate.portfolio_url',
      'urls[linkedin]': 'candidate.linkedin',
      'urls[github]': 'candidate.github',
      'comments': 'cover_letter',
      'resume': 'cv',
    },
    notes: 'Lever uses clean REST form. Simple flat fields. Direct apply: https://jobs.lever.co/{company}/{id}/apply',
    fieldExamples: ['name', 'email', 'phone', 'urls[linkedin]', 'urls[github]', 'comments', 'resume'],
  },
  Workable: {
    mapping: {
      'full_name': 'candidate.first_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'linkedin': 'candidate.linkedin',
      'website': 'candidate.portfolio_url',
      'education': 'candidate.education',
      'cover': 'cover_letter',
    },
    notes: 'Workable supports quick apply via LinkedIn. Direct apply: https://apply.workable.com/{company}/j/{id}/',
    fieldExamples: ['full_name', 'email', 'phone', 'linkedin', 'website', 'education', 'cover'],
  },
  'BambooHR': {
    mapping: {
      'firstName': 'candidate.first_name',
      'lastName': 'candidate.last_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'address': 'candidate.location',
      'linkedin': 'candidate.linkedin',
      'resume': 'cv',
    },
    notes: 'BambooHR forms are straightforward but may require account creation.',
    fieldExamples: ['firstName', 'lastName', 'email', 'phone', 'address', 'linkedin', 'resume'],
  },
  Internshala: {
    mapping: {
      'name': 'candidate.first_name',
      'email': 'candidate.email',
      'mobile': 'candidate.phone',
      'city': 'candidate.location',
      'resume': 'cv',
      'cover': 'cover_letter',
    },
    notes: 'Internshala requires login. Fields are in a standard form. Direct apply URL: https://internshala.com/internship/{id}',
    fieldExamples: ['name', 'email', 'mobile', 'city', 'resume', 'cover'],
  },
};

function resolveProfileValue(path, profile) {
  const parts = path.split('.');
  let val = profile;
  let found = true;
  for (const p of parts) {
    if (val && typeof val === 'object' && p in val) val = val[p];
    else { found = false; break; }
  }
  if (found && val && typeof val === 'string') return val;

  // Fallback: split full_name into first/last
  if (path === 'candidate.first_name' || path === 'candidate.name') {
    const full = resolveProfileValueNoFallback('candidate.full_name', profile) || resolveProfileValueNoFallback('candidate.name', profile);
    if (full) return full.split(' ')[0];
  }
  if (path === 'candidate.last_name') {
    const full = resolveProfileValueNoFallback('candidate.full_name', profile) || resolveProfileValueNoFallback('candidate.name', profile);
    const nameParts = full.split(' ');
    if (nameParts.length > 1) return nameParts.slice(1).join(' ');
  }
  return '';
}

function resolveProfileValueNoFallback(path, profile) {
  const parts = path.split('.');
  let val = profile;
  for (const p of parts) {
    if (val && typeof val === 'object' && p in val) val = val[p];
    else return '';
  }
  return (val && typeof val === 'string') ? val : '';
}

function generateManualGuide(atsType, url, profile, pageFields) {
  const known = ATS_KNOWN_PATTERNS[atsType];
  const fields = [];

  if (known) {
    for (const [fieldName, profilePath] of Object.entries(known.mapping)) {
      const value = resolveProfileValue(profilePath, profile);
      fields.push({ field: fieldName, value, source: 'ats_pattern' });
    }
  }

  // Add any fields extracted from the page (best-effort DOM extraction)
  if (pageFields && Array.isArray(pageFields)) {
    for (const f of pageFields) {
      if (!fields.some(x => x.field === f.id || x.field === f.label)) {
        fields.push({ field: f.label || f.id, value: '', source: 'dom_extraction', required: f.required });
      }
    }
  }

  // If unknown ATS, add generic typical fields
  if (!known) {
    const genericFields = [
      { field: 'Full Name', value: resolveProfileValue('candidate.full_name', profile) || resolveProfileValue('candidate.name', profile), source: 'generic' },
      { field: 'Email', value: resolveProfileValue('candidate.email', profile), source: 'generic' },
      { field: 'Phone', value: resolveProfileValue('candidate.phone', profile), source: 'generic' },
      { field: 'Location / City', value: resolveProfileValue('location.city', profile) || resolveProfileValue('candidate.location', profile), source: 'generic' },
      { field: 'LinkedIn URL', value: resolveProfileValue('candidate.linkedin', profile), source: 'generic' },
      { field: 'GitHub / Portfolio', value: resolveProfileValue('candidate.github', profile) || resolveProfileValue('candidate.portfolio_url', profile), source: 'generic' },
      { field: 'Years of Experience', value: resolveProfileValue('candidate.experience_years', profile), source: 'generic' },
      { field: 'Expected Salary / CTC', value: resolveProfileValue('compensation.target_range', profile), source: 'generic' },
      { field: 'Resume / CV', value: '(attach file)', source: 'generic' },
      { field: 'Cover Letter / Message', value: `Dear Hiring Team,\n\nI am applying for this role and believe my skills are a strong match. My resume is attached.\n\nBest regards,\n${resolveProfileValue('candidate.full_name', profile) || 'Candidate'}`, source: 'generic' },
    ];
    for (const g of genericFields) {
      if (!fields.some(x => x.field === g.field)) fields.push(g);
    }
  }

  return {
    ats_type: atsType || 'unknown',
    ats_platform: atsType || 'Custom / Unknown',
    confidence: known ? 'high' : 'low',
    url,
    manual_apply_url: url,
    fields,
    estimated_fill_minutes: known ? (atsType === 'Workday' ? 15 : 5) : 8,
    notes: known?.notes || 'No specific ATS information available. Fill in the standard application fields manually.',
  };
}

if (!jobUrl) {
  console.log(JSON.stringify({ error: 'URL required', usage: 'node apply-job.mjs <url> [--fill --answers-json <path>] [--user-dir <dir>]' }));
  process.exit(1);
}

// ── Load user data ──────────────────────────────────────────────────

function loadProfile() {
  const p = join(userDir, 'config', 'profile.yml');
  if (!existsSync(p)) return {};
  try {
    const content = readFileSync(p, 'utf-8');
    try { return JSON.parse(content); } catch {}
    const yaml = require('js-yaml');
    return yaml.load(content) || {};
  } catch { return {}; }
}

// Persistent store of answers to candidate-confirmation form questions
// (salary, years of experience, office commute, etc). Asked once, reused
// across forms. Lives in config/form-answers.yml (user layer).
function loadFormAnswers() {
  const p = join(userDir, 'config', 'form-answers.yml');
  if (!existsSync(p)) return {};
  try {
    const yaml = require('js-yaml');
    return yaml.load(readFileSync(p, 'utf-8')) || {};
  } catch { return {}; }
}

function loadCv() {
  const p = join(userDir, 'cv.md');
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

function resolveTailoredCv(company) {
  // Search the generated-CV output dir AND the user's uploads dir so a CV
  // uploaded at onboarding (or a freshly generated generic PDF) is always
  // found. Prefers a company-specific match, then 'generic', then the
  // newest PDF/DOCX on disk.
  const outputDir = join(userDir, 'output');
  const uploadsDir = join(userDir, 'data', 'uploads');
  const dirs = [];
  if (existsSync(outputDir)) dirs.push(outputDir);
  if (existsSync(uploadsDir)) dirs.push(uploadsDir);

  const slug = (company || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const all = [];
  for (const d of dirs) {
    for (const f of readdirSync(d)) {
      const fp = join(d, f);
      try { if (!statSync(fp).isFile()) continue; } catch { continue; }
      if (!/\.(pdf|docx?)$/i.test(f)) continue;
      all.push({ path: fp, name: f, time: statSync(fp).mtimeMs });
    }
  }
  all.sort((a, b) => b.time - a.time);
  for (const f of all) if (f.name.toLowerCase().includes(slug)) return f.path;
  for (const f of all) if (/generic/i.test(f.name)) return f.path;
  if (all.length) return all[0].path;
  return null;
}

// ── Click Apply button (reveals dynamic forms) ───────────────────────
// Returns the page that hosts the application form. Clicking "Apply" on
// job boards (Internshala, Naukri, Indeed, ...) often opens a NEW TAB or
// navigates to the real form — so we watch for a popup and return that
// page when it appears, otherwise return the same page.
async function clickApplyButton(page, context) {
  const patterns = [
    { selector: 'button', hasText: /^(?:\s*)(?:apply|apply now|apply for|apply here|submit application)\b/i },
    { selector: 'a', hasText: /^(?:\s*)(?:apply|apply now|apply for|apply here|submit application)\b/i },
    { selector: '[role="button"]', hasText: /^(?:\s*)(?:apply|apply now|apply for|apply here|submit application)\b/i },
    { selector: '[class*="apply"]', hasText: /^(?:\s*)(?:apply|apply now|apply for|apply here|submit application)\b/i },
    { selector: '[data-testid*="apply"]', hasText: /^(?:\s*)(?:apply|apply now|apply for|apply here|submit application)\b/i },
  ];
  for (const { selector, hasText } of patterns) {
    try {
      const locator = page.locator(selector).filter({ hasText }).first();
      const visible = await locator.isVisible({ timeout: 1500 }).catch(() => false);
      if (!visible) continue;
      const text = await locator.textContent().catch(() => '');
      if (/submitted|already|applied|sent|thank/i.test(text)) continue;
      const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await locator.click({ timeout: 5000 });
      const newPage = await popupPromise;
      if (newPage) {
        await newPage.waitForLoadState('domcontentloaded').catch(() => {});
        await newPage.waitForTimeout(2500);
        return newPage;
      }
      await page.waitForTimeout(3000);
      return page;
    } catch { /* not found or not clickable */ }
  }

  // Fallback: job boards (Internshala, Naukri, ...) render an "Apply now"
  // anchor that Playwright's actionability check can't reach (sticky headers,
  // invisible backdrops). A synthetic JS click navigates those reliably.
  try {
    const clicked = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const isApplyText = (t) => /^\s*(apply now|apply for|apply here|apply)\b/i.test((t || '').trim());
      const all = Array.from(document.querySelectorAll('a, button, [role="button"]'));
      const visEls = all.filter((e) => vis(e));
      const link = visEls.find((e) => isApplyText(e.textContent || '') && /(interstitial|application|apply)/i.test(e.getAttribute('href') || ''));
      const el = link || visEls.find((e) => isApplyText(e.textContent || ''));
      if (!el) return false;
      el.click();
      return true;
    });
    if (clicked) {
      const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      const newPage = await popupPromise;
      if (newPage) {
        await newPage.waitForLoadState('domcontentloaded').catch(() => {});
        await newPage.waitForTimeout(2500);
        return newPage;
      }
      await page.waitForTimeout(3000);
    }
  } catch { /* not found */ }
  return page;
}

// ── Extract fields (default mode) ───────────────────────────────────
// Reads form controls from the main document AND every iframe — ATS
// forms (Internshala, Naukri, Workday) are frequently embedded in an
// iframe or rendered into shadow DOM, which a single-document query
// misses. Visibility uses the layout box instead of offsetParent so
// fixed-position / transformed widgets aren't dropped.

async function extractFields(page) {
  // Google's own sign-in/consent page is an auth wall, never an application
  // form — returning nothing here prevents a false "form filled" success.
  if (isGoogleAuthPage(page)) return [];
  const results = [];
  const seen = new Set();
  const frames = [page.mainFrame(), ...page.frames()];
  for (const frame of frames) {
    let fields;
    try {
      fields = await frame.evaluate(() => {
        const result = [];
        const inputs = document.querySelectorAll('input, textarea, select, [role="combobox"]');
        for (const el of inputs) {
          if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'image') continue;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;

          const label = el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            el.closest('label')?.textContent?.trim() || '';

          result.push({
            id: el.id || el.name || `field_${result.length}`,
            type: el.tagName.toLowerCase() === 'select' ? 'select' :
                  el.tagName.toLowerCase() === 'textarea' ? 'textarea' :
                  el.type || 'text',
            label: label.slice(0, 100),
            required: el.required || el.getAttribute('aria-required') === 'true',
            options: el.tagName.toLowerCase() === 'select'
              ? Array.from(el.options).map(o => o.text).slice(0, 20)
              : undefined,
          });
        }
        return result;
      });
    } catch {
      continue; // cross-origin or detached frame — skip
    }
    for (const f of fields || []) {
      const key = `${f.id}|${f.label}|${f.type}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(f);
    }
  }
  return results;
}

// Wait for a dynamic/SPA form to finish rendering visible input fields.
// Many ATS boards mount the form via JS only AFTER the "Apply" click —
// poll (main document + iframes) until at least one visible form control
// exists, or the timeout elapses. Returns the number of fields found.
async function waitForFormFields(page, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await page.evaluate(() => {
      let n = 0;
      const scan = (root) => {
        for (const el of root.querySelectorAll('input, textarea, select, [role="combobox"]')) {
          if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) n++;
        }
      };
      scan(document);
      for (const f of document.querySelectorAll('iframe')) {
        try { if (f.contentDocument) scan(f.contentDocument); } catch { /* cross-origin */ }
      }
      return n;
    }).catch(() => 0);
    if (count > 0) return count;
    await page.waitForTimeout(1000);
  }
  return 0;
}

// Detect a login/registration wall hiding the application form. Job boards
// (Internshala, Naukri, LinkedIn, ...) render the real form only after auth —
// often as a hidden modal pre-loaded with email/password/signup fields.
// Returns a human-readable label or null when no auth wall is present.
async function detectLoginWall(page) {
  // Full-page auth redirects (Internshala /registration/student, Naukri
  // /login, ...) bounce unauthenticated visitors off the job page — treat
  // those as a login wall so the auto-login flow kicks in below.
  try {
    const u = new URL(page.url());
    if (/^\/(?:registration|login|signin|sign-?up|auth|accounts?)(?:[/?]|$)/i.test(u.pathname)) {
      return `auth-page redirect (${u.pathname})`;
    }
  } catch { /* fall through to DOM check */ }
  const label = await page.evaluate(() => {
    const hasText = (sel, re) => {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.textContent || el.value || '').toLowerCase();
        if (re.test(t)) return true;
      }
      return false;
    };
    const authFieldNames = ['email', 'password', 'passwd', 'first_name', 'last_name', 'modal_email', 'modal_password', 'login', 'register', 'signup'];
    const names = Array.from(document.querySelectorAll('input')).map(i => (i.name || i.id || '').toLowerCase());
    const authCount = names.filter(n => authFieldNames.some(a => n.includes(a))).length;
    const visiblePassword = Array.from(document.querySelectorAll('input[type="password"]'))
      .some(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0);
    const hasAuthUi = hasText('button, a, [role="button"]', /^(?:log in|sign in|login|register|create account|sign up)\b/i);

    if (visiblePassword && hasAuthUi) return 'visible sign-in form';
    if (authCount >= 3 && hasAuthUi) return 'hidden account modal (pre-loaded auth fields)';
    if (authCount >= 2 && hasText('form', /login|register|sign in/i)) return 'login/register form';
    return null;
  }).catch(() => null);
  return label;
}

// Detect the portal's auth entry point even when the password field is not
// yet visible (many portals show an email field + "Login with Google" first).
// Returns 'google', 'portal-email', or null.
async function findAuthEntry(page) {
  try {
    return await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const googleEl = Array.from(document.querySelectorAll(
        'a[href*="google" i], a[href*="accounts.google" i], [id*="google" i], [class*="google" i], button, [role="button"]'
      )).find((el) => vis(el) && (
        /continue with google|sign ?in with google|log ?in with google|sign ?up with google|login with google|google login|google sign/i.test((el.textContent || '').toLowerCase()) ||
        (el.getAttribute('href') || '').toLowerCase().includes('google')
      ));
      if (googleEl) return 'google';
      const emailInput = Array.from(document.querySelectorAll('input')).find((el) => vis(el) && !['hidden', 'submit', 'button', 'file'].includes(el.type) &&
        /(email|username|user_name|mobile|phone)/i.test((el.name || el.id || el.getAttribute('aria-label') || el.placeholder || '').toLowerCase()));
      if (emailInput) return 'portal-email';
      return null;
    }).catch(() => null);
  } catch {
    return null;
  }
}

// Human-readable description of the current auth state (for diagnostics).
async function describeAuthState(page) {
  try {
    return await page.evaluate(() => ({
      url: location.href.slice(0, 200),
      title: document.title.slice(0, 120),
      googleAuth: /accounts\.google\.com/.test(location.href),
      googleLoginButton: !!Array.from(document.querySelectorAll('a,button,[role="button"]'))
        .find(e => /continue with google|sign ?in with google|log ?in with google|login with google|google login/i.test((e.textContent || '').toLowerCase())),
      visiblePassword: !!Array.from(document.querySelectorAll('input[type="password"]'))
        .find(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0),
      visibleEmail: !!Array.from(document.querySelectorAll('input')).find(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && /(email|username)/i.test((e.name || e.id || e.placeholder || '').toLowerCase());
      }),
    }));
  } catch {
    return null;
  }
}

// ── Portal auto-login ───────────────────────────────────────────────
// Login-gated portals (Internshala, Naukri, Shine, ...) only render their
// application form after auth. We establish the session automatically:
//   1. Google OAuth is the PREFERRED path — click "Continue with Google"
//      and reuse the user's Gmail OAuth session in the persistent profile.
//   2. Portal email/password from the per-user vault (.portal-creds.json)
//      is the fallback for portals without Google sign-in.
// The application form itself is NEVER submitted — only login is automated.

function detectPortalFromUrl(urlStr) {
  const host = ((urlStr || '').toLowerCase().match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
  const patterns = [
    ['Internshala', 'internshala.com'], ['Naukri', 'naukri.com'], ['Shine', 'shine.com'],
    ['TimesJobs', 'timesjobs.com'], ['Hirist', 'hirist'], ['iimjobs', 'iimjobs.com'],
    ['Foundit', 'foundit'], ['Instahyre', 'instahyre.com'], ['Cutshort', 'cutshort.io'],
    ['Freshersworld', 'freshersworld.com'], ['LinkedIn', 'linkedin.com'], ['Glassdoor', 'glassdoor'],
    ['Indeed', 'indeed.com'], ['Monster', 'monsterindia.com'],
  ];
  for (const [name, pat] of patterns) {
    if (host.endsWith(pat) || host.includes(pat)) return name;
  }
  return null;
}

function loadPortalCreds(userDir, urlStr) {
  const portal = detectPortalFromUrl(urlStr);
  if (!portal) return null;
  try {
    const p = join(userDir, '.portal-creds.json');
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, 'utf-8').trim());
    const creds = data[portal.toLowerCase()];
    if (!creds || !creds.email) return null;
    return { portal, ...creds };
  } catch {
    return null;
  }
}

// Fill the portal's email/password auth inputs and click the login button.
async function loginWithPortalCreds(page, creds) {
  try {
    const ok = await page.evaluate(({ email, password }) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const findByName = (names) => {
        for (const n of names) {
          const el = inputs.find(i => (i.name || i.id || '').toLowerCase().includes(n));
          if (el && el.type !== 'hidden' && el.type !== 'file') return el;
        }
        return null;
      };
      const emailEl = findByName(['modal_email', 'email', 'username', 'login', 'user_name', 'usr']);
      const passEl = findByName(['modal_password', 'password', 'passwd', 'pwd']);
      if (!emailEl || !passEl) return 'missing-auth-fields';
      const setVal = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(emailEl, email);
      setVal(passEl, password);
      return 'filled';
    }, { email: creds.email, password: creds.password || '' });
    if (ok !== 'filled') return { ok: false, reason: ok };

    await page.waitForTimeout(300);
    const clickedSubmit = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'));
      const candidates = els.filter(e => {
        const t = (e.textContent || e.value || '').toLowerCase().trim();
        return /^(log ?in|sign ?in|login|continue|next|submit|register)\b/.test(t) || /\blog ?in\b|\bsign ?in\b/.test(t);
      });
      if (candidates.length === 0) return false;
      const vis = candidates.find(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      (vis || candidates[0]).click();
      return true;
    });
    await page.waitForTimeout(3500);
    return { ok: true, clickedSubmit };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Click "Continue with Google" and drive the Google account picker / OAuth
// consent using the profile's Gmail session. Returns ok=true only when the
// session is actually established and the login wall is gone. If the flow
// lands on Google's own sign-in fields (session missing) it returns ok=false
// so the caller reports an honest failure instead of filling Google's form.
async function loginWithGoogleOAuth(page, context, profileEmail) {
  try {
    // Stale Google cookies left in the persistent profile (rotated LSID/OSID
    // remnants from earlier sessions) trigger accounts.google.com/CookieMismatch
    // and abort the whole login. Clear them and re-seed a fresh, consistent
    // set from the app's captured session before starting OAuth.
    try {
      const cdp = await context.newCDPSession(page);
      const { cookies } = await cdp.send('Network.getAllCookies');
      for (const c of cookies.filter((x) => (x.domain || '').endsWith('google.com'))) {
        try { await cdp.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path }); } catch {}
      }
      await context.addCookies(loadGoogleCookies(userDir));
    } catch {}

    const clicked = await page.evaluate(() => {
      // Prefer a real anchor/button that mentions google (href/id/class), then
      // fall back to text matching (e.g. Internshala's "Login with Google").
      const byAttr = Array.from(document.querySelectorAll(
        'a[href*="google" i], a[href*="get_google" i], a[href*="accounts.google" i], [id*="google" i], [class*="google" i]'
      )).filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      let el = byAttr[0];
      if (!el) {
        el = Array.from(document.querySelectorAll('a, button, [role="button"]')).find(e => {
          if (/continue with google|sign ?in with google|log ?in with google|sign ?up with google|login with google|google login|google sign|google account/i.test((e.textContent || '').toLowerCase())) return true;
          if (e.tagName === 'IMG' && (e.src || '').toLowerCase().includes('google')) return true;
          return false;
        });
      }
      if (!el) return false;
      el.click();
      return true;
    });
    if (!clicked) return { ok: false, reason: 'no-google-button' };

    // The Google auth may open in a popup or navigate the same tab.
    const popup = await page.waitForEvent('popup', { timeout: 12000 }).catch(() => null);
    const target = popup || page;

    // Wait until we're actually on Google's auth domain before doing anything.
    await target.waitForURL(/accounts\.google\.com|google\.com\/o\/oauth2/, { timeout: 20000 }).catch(() => {});
    await target.waitForTimeout(1500);

    // Account chooser: the modern v3 page renders each account as a BUTTON
    // whose text contains the user's email, the legacy page uses a
    // [data-identifier] row. Prefer a TRUSTED click (synthetic JS clicks are
    // ignored by Google's handlers), falling back to JS for legacy markup.
    let clickedAccount = false;
    if (profileEmail) {
      try {
        const acct = target.locator('button, [role="button"], [data-identifier]')
          .filter({ hasText: profileEmail }).first();
        if (await acct.isVisible({ timeout: 3000 }).catch(() => false)) {
          await acct.click({ timeout: 5000 });
          clickedAccount = true;
        }
      } catch {}
    }
    if (!clickedAccount) {
      clickedAccount = await target.evaluate((email) => {
        const row = document.querySelector('[data-identifier]');
        if (row) { row.click(); return true; }
        if (email) {
          const b = Array.from(document.querySelectorAll('button, [role="button"]'))
            .find(e => (e.textContent || '').includes(email));
          if (b) { b.click(); return true; }
        }
        return false;
      }, profileEmail || '').catch(() => false);
    }

    if (clickedAccount) {
      // Approve the OAuth consent (this is the portal login the user opted
      // into). Needs a TRUSTED click — Google's consent handler ignores
      // synthetic page.evaluate clicks, leaving the page stuck on consent.
      await target.waitForTimeout(1200);
      for (let i = 0; i < 20; i++) {
        try {
          const allow = target.locator('button, [role="button"], input[type="submit"]')
            .filter({ hasText: /^(allow|continue|continue as)$/i }).first();
          if (await allow.isVisible({ timeout: 800 }).catch(() => false)) {
            await allow.click({ timeout: 4000 });
            break;
          }
        } catch {}
        await target.waitForTimeout(500);
      }
    } else {
      // No account chooser — Google is asking for credentials. Can't type a
      // password headless; the one-time login screen is required instead.
      const needsLogin = await target.evaluate(() =>
        !!document.getElementById('identifierId') ||
        !!document.getElementById('passwd') ||
        !!document.querySelector('input[name="Passwd"], input[name="password"]')
      ).catch(() => false);
      if (needsLogin) return { ok: false, reason: 'google-signin-required' };
    }

    // Wait for the OAuth round-trip back to the portal.
    await page.waitForTimeout(8000);
    if (/accounts\.google\.com/.test(page.url())) {
      return { ok: false, reason: 'google-still-on-auth' };
    }
    const stillWall = await detectLoginWall(page);
    return { ok: !stillWall, stillWall };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Google's own sign-in page must never be treated as an application form.
function isGoogleAuthPage(page) {
  try {
    if (/accounts\.google\.com/.test(page.url())) return true;
  } catch {}
  return false;
}

// Resume-upload-first onboarding (Shine, apna.co, ...): some portals present
// an "Upload your resume" step whose real file input is visually hidden, then
// render the actual form after parsing the CV. When no visible fields exist
// but a (hidden) file input does, upload the CV and poll for the parsed form.
async function uploadResumeFirst(page, userDir, company) {
  try {
    const hasFileInput = await page.evaluate(() =>
      !!document.querySelector('input[type="file"]')
    );
    if (!hasFileInput) return [];
    const cvPath = resolveTailoredCv(company);
    if (!cvPath) return [];
    await page.locator('input[type="file"]').first().setInputFiles(cvPath);
    // Poll for non-file, visible form controls (resume parsing takes seconds).
    const start = Date.now();
    while (Date.now() - start < 40000) {
      const count = await page.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          const s = window.getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        return Array.from(document.querySelectorAll('input:not([type="file"]), textarea, select')).filter(vis).length;
      }).catch(() => 0);
      if (count > 0) return await extractFields(page);
      await page.waitForTimeout(2000);
    }
    return [];
  } catch {
    return [];
  }
}

// ── Form field categorization ───────────────────────────────────────
// Maps a field's visible label to a canonical category. Categories with
// no profile.yml answer are surfaced as pending_questions so the app can
// ask the candidate inline instead of silently skipping the field.

const FIELD_CATEGORIES = [
  { category: 'first_name', test: (l) => (l.includes('first name') || l.includes('given name')) && !l.includes('company') },
  { category: 'last_name',  test: (l) => (l.includes('last name') || l.includes('surname') || l.includes('family name')) && !l.includes('company') },
  { category: 'name',        test: (l) => l.includes('name') && !l.includes('company') && !l.includes('first') && !l.includes('last') },
  { category: 'email',       test: (l) => l.includes('email') },
  { category: 'phone',       test: (l) => l.includes('phone') || l.includes('mobile') },
  { category: 'location',    test: (l) => l.includes('location') || l.includes('city') || l.includes('address') },
  { category: 'linkedin',    test: (l) => l.includes('linkedin') },
  { category: 'github',      test: (l) => l.includes('github') },
  { category: 'portfolio',   test: (l) => l.includes('portfolio') || l.includes('website') || l.includes('blog') },
  { category: 'resume',      test: (l) => l.includes('resume') || l.includes('cv') },
  { category: 'cover_letter',test: (l) => l.includes('cover') || l.includes('message') || l.includes('additional') || l.includes('comment') || l.includes('why') || l.includes('interest') },
  { category: 'experience_years', test: (l) => (l.includes('experience') || l.includes('year') || l.includes('yoe')) && !l.includes('company') },
  { category: 'current_salary',   test: (l) => (l.includes('current') && (l.includes('salary') || l.includes('ctc') || l.includes('compensation'))) || l.includes('current ctc') },
  { category: 'expected_salary',  test: (l) => (l.includes('expected') || l.includes('desired') || l.includes('target')) && (l.includes('salary') || l.includes('ctc') || l.includes('compensation')) },
  { category: 'salary',      test: (l) => l.includes('salary') || l.includes('ctc') || l.includes('compensation') },
  { category: 'office_commute', test: (l) => (l.includes('office') && (l.includes('comfort') || l.includes('commute') || l.includes('willing') || l.includes('on-site') || l.includes('onsite') || l.includes('work from office'))) || l.includes('commute') || l.includes('relocation') || l.includes('willing to relocate') || l.includes('work from office') },
  { category: 'notice_period', test: (l) => l.includes('notice') || l.includes('join') || l.includes('available') || l.includes('start date') },
  { category: 'work_authorization', test: (l) => l.includes('authorization') || l.includes('authorisation') || l.includes('visa') || l.includes('sponsor') || l.includes('right to work') || l.includes('work permit') || l.includes('citizen') },
  { category: 'education',   test: (l) => l.includes('degree') || l.includes('education') || l.includes('qualification') || l.includes('university') || l.includes('college') },
  { category: 'gender',      test: (l) => l.includes('gender') },
  { category: 'disability',  test: (l) => l.includes('disability') || l.includes('veteran') },
  { category: 'how_heard',   test: (l) => l.includes('how did you hear') || l.includes('referral') || l.includes('source') || l.includes('found out') },
  { category: 'referral',    test: (l) => l.includes('referral') && !l.includes('source') },
];

function classifyField(field) {
  const l = (field.label || '').toLowerCase().trim();
  if (!l) return null;
  for (const f of FIELD_CATEGORIES) {
    if (f.test(l)) return f.category;
  }
  return null;
}

// Which categories the app MUST ask the candidate about — never guessed.
const CANDIDATE_CONFIRMATION = new Set([
  'experience_years', 'current_salary', 'expected_salary', 'salary',
  'office_commute', 'notice_period', 'work_authorization',
]);

// Answer a field from profile + form-answers. Returns { value, source }.
function answerField(category, field, profile, formAnswers, coverText) {
  const c = profile.candidate || profile;
  const comp = profile.compensation || {};
  switch (category) {
    case 'first_name': {
      const full = c.full_name || c.name || '';
      return { value: full.split(' ')[0] || full, source: 'profile' };
    }
    case 'last_name': {
      const full = c.full_name || c.name || '';
      const parts = full.split(' ');
      return { value: parts.length > 1 ? parts.slice(1).join(' ') : '', source: 'profile' };
    }
    case 'name': return { value: c.full_name || c.name || '', source: 'profile' };
    case 'email': return { value: c.email || '', source: 'profile' };
    case 'phone': return { value: c.phone || '', source: 'profile' };
    case 'location': return { value: profile.location?.city || profile.location || '', source: 'profile' };
    case 'linkedin': return { value: c.linkedin || '', source: 'profile' };
    case 'github': return { value: c.github || '', source: 'profile' };
    case 'portfolio': return { value: c.portfolio_url || c.portfolio || c.github || '', source: 'profile' };
    case 'resume': return { value: '', source: 'file' }; // handled by CV attach
    case 'cover_letter': return { value: coverText, source: 'profile' };
    case 'experience_years': return { value: formAnswers.experience_years || c.experience_years || '', source: 'form-answers' };
    case 'current_salary': return { value: formAnswers.current_salary || '', source: 'form-answers' };
    case 'expected_salary': return { value: formAnswers.expected_salary || comp.target_range || '', source: formAnswers.expected_salary ? 'form-answers' : 'profile' };
    case 'salary': return { value: formAnswers.expected_salary || comp.target_range || '', source: formAnswers.expected_salary ? 'form-answers' : 'profile' };
    case 'office_commute': return { value: formAnswers.office_commute || '', source: 'form-answers' };
    case 'notice_period': return { value: formAnswers.notice_period || '', source: 'form-answers' };
    case 'work_authorization': return { value: formAnswers.work_authorization || profile.location?.visa_status || '', source: formAnswers.work_authorization ? 'form-answers' : 'profile' };
    case 'education': return { value: formAnswers.education || '', source: 'form-answers' };
    case 'gender': return { value: '', source: 'candidate' };
    case 'disability': return { value: '', source: 'candidate' };
    case 'how_heard': return { value: '', source: 'candidate' };
    case 'referral': return { value: '', source: 'candidate' };
    default: return { value: '', source: 'none' };
  }
}

const DEFAULT_COVER_LETTER = `Dear Hiring Team,

I am applying for this role and believe my skills are a strong match. My resume is attached for your review.

Best regards,
`;

function generateAnswers(fields, profile, formAnswers) {
  const answers = {};
  const pendingQuestions = [];
  const coverText = `${DEFAULT_COVER_LETTER}${profile.candidate?.full_name || profile.candidate?.name || 'Candidate'}`;
  for (const field of fields) {
    const category = classifyField(field);
    if (!category) {
      if (field.required) {
        pendingQuestions.push(buildQuestion(field, 'other', ''));
      }
      continue;
    }
    const { value, source } = answerField(category, field, profile, formAnswers, coverText);
    if (value && value.trim()) {
      answers[field.id] = value;
    } else if (CANDIDATE_CONFIRMATION.has(category) || field.required) {
      pendingQuestions.push(buildQuestion(field, category, source));
    }
  }
  return { answers, pendingQuestions };
}

function buildQuestion(field, category, source) {
  const hints = {
    experience_years: 'Years of work experience, excluding internships. E.g. "2" or "1.5".',
    current_salary: 'Current annual CTC in LPA, e.g. "2.4 LPA". Choose from options if provided.',
    expected_salary: 'Expected annual CTC in LPA, e.g. "4 LPA". Choose from options if provided.',
    salary: 'Salary / CTC in LPA, e.g. "4 LPA".',
    office_commute: 'Are you willing to work from the office (commute)? Yes/No.',
    notice_period: 'Current notice period / joining availability, e.g. "30 days" or "Immediate".',
    work_authorization: 'Work authorization / visa status. Indian citizen, no sponsorship needed.',
    education: 'Highest qualification, e.g. "B.E. IT, 2024".',
    gender: 'Optional — required by the ATS form.',
    disability: 'Optional — required by the ATS form.',
    how_heard: 'How did you find this posting?',
    referral: 'Referral name / source.',
    other: 'Required field that could not be auto-filled.',
  };
  return {
    field_id: field.id,
    category,
    label: field.label || field.id,
    required: !!field.required,
    type: field.type === 'select' ? 'select' : 'text',
    options: field.type === 'select' && Array.isArray(field.options) ? field.options : [],
    hint: hints[category] || '',
    source,
  };
}

// ── Fill form (--fill mode) ─────────────────────────────────────────

async function fillForm(page, answers) {
  const filled = [];
  const skipped = [];

  for (const [fieldId, value] of Object.entries(answers)) {
    if (!value) { skipped.push(fieldId); continue; }
    try {
      // Escape id/name so attribute selectors handle brackets, dots, colons
      // (ATS fields are frequently named candidate[first_name], urls[linkedin]).
      const cssEscape = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      let el = await page.$(`[id="${cssEscape(fieldId)}"]`);
      if (!el) el = await page.$(`[name="${cssEscape(fieldId)}"]`);
      if (!el) { skipped.push(fieldId); continue; }

      const tag = await el.evaluate(e => e.tagName.toLowerCase());
      if (tag === 'select') {
        // Try to match by text
        const matched = await el.evaluate((sel, val) => {
          const opts = Array.from(sel.options);
          const match = opts.find(o => o.text.toLowerCase().includes(val.toLowerCase()));
          if (match) { sel.value = match.value; return true; }
          return false;
        }, value);
        if (matched) filled.push(fieldId);
        else skipped.push(fieldId);
      } else if (tag === 'input' || tag === 'textarea') {
        await el.click();
        await el.fill('');
        await el.fill(String(value));
        filled.push(fieldId);
      }
    } catch {
      skipped.push(fieldId);
    }
  }

  return { filled, skipped };
}

// ── Browserless fallback (no Playwright/browser) ────────────────────
// When Chromium can't launch (e.g. ARM64 bionic rejects the official
// headless shell's TLS segment alignment, missing system libs, sandbox
// errors), fetch the posting HTML over HTTP and extract form fields with
// regex. Every app user then still gets real answers + a manual apply
// guide instead of a dead "auto-fill failed" error.

const FORM_TAG_RE = /<(input|select|textarea)\b([^>]*)>/gi;
const OPTION_TAG_RE = /<option\b[^>]*>([\s\S]*?)<\/option>/gi;

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseFieldsFromHtml(html) {
  const fields = [];
  const seen = new Set();
  const attrRe = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = FORM_TAG_RE.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrsRaw = m[2] || '';
    const attrs = {};
    attrRe.lastIndex = 0;
    let am;
    while ((am = attrRe.exec(attrsRaw)) !== null) {
      attrs[am[1]] = am[2] ?? am[3] ?? am[4] ?? '';
    }
    const type = (attrs.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') continue;
    const nameOrId = attrs.name || attrs.id || '';
    if (!nameOrId) continue;
    if (seen.has(nameOrId)) continue;
    seen.add(nameOrId);

    let options;
    if (tag === 'select') {
      options = [];
      const closeIdx = html.indexOf('</select>', m.index);
      const block = closeIdx >= 0 ? html.slice(m.index, closeIdx) : html.slice(m.index, m.index + 8000);
      OPTION_TAG_RE.lastIndex = 0;
      let om;
      while ((om = OPTION_TAG_RE.exec(block)) !== null) {
        const txt = om[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (txt) options.push(txt.slice(0, 60));
        if (options.length >= 20) break;
      }
    }

    const label = attrs['aria-label'] || attrs.placeholder || nameOrId;
    const required = (/(?:^|\s)required(?:\s|>|=)/i).test(attrsRaw) || attrs['aria-required'] === 'true';
    fields.push({
      id: attrs.id || attrs.name || `field_${fields.length}`,
      type: tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (type || 'text'),
      label: label.slice(0, 100),
      required,
      ...(options ? { options } : {}),
    });
  }
  return fields;
}

async function browserlessExtract(jobUrl, profile, formAnswers) {
  const html = await fetchHtml(jobUrl);
  if (!html) return null;
  const fields = parseFieldsFromHtml(html);
  const atsType = detectAtsType(jobUrl);
  const { answers, pendingQuestions } = generateAnswers(fields, profile, formAnswers);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const guide = generateManualGuide(atsType, jobUrl, profile, fields);
  return { title, atsType, fields, answers, pendingQuestions, guide };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const profile = loadProfile();
  const cv = loadCv();

  // ── Manual Guide Mode (no browser needed) ──
  if (manualGuideMode) {
    const atsType = detectAtsType(jobUrl);
    const guide = generateManualGuide(atsType, jobUrl, profile, []);
    console.log(JSON.stringify({
      success: true,
      mode: 'manual_guide',
      url: jobUrl,
      atsType,
      manual_apply_guide: guide,
      message: 'Manual apply guide generated. Open the URL in your browser and fill the fields listed.',
      manualUrl: jobUrl,
    }, null, 2));
    process.exit(0);
  }

  // Check if Playwright is available (optional stealth plugin)
  let chromium;
  let usedStealth = false;
  try {
    if (stealthMode) {
      const pwExtra = await import('playwright-extra').catch(() => null);
      if (pwExtra) {
        const StealthPlugin = (await import('puppeteer-extra-plugin-stealth').catch(() => null))?.default;
        if (StealthPlugin) {
          chromium = pwExtra.chromium;
          chromium.use(StealthPlugin());
          usedStealth = true;
        }
      }
    }
    if (!chromium) {
      const pw = await import('playwright');
      chromium = pw.chromium;
    }
  } catch {
    try {
      const pw = await import('playwright-core');
      chromium = pw.chromium;
    } catch {
      console.log(JSON.stringify({
        error: 'Playwright not installed',
        manualUrl: jobUrl,
        reason: 'Playwright library not available — install with: npm install playwright',
        instructions: 'Open the URL in your browser and apply manually.',
      }));
      process.exit(0);
    }
  }

  // Load answers for fill mode
  let fillAnswers = {};
  const formAnswers = loadFormAnswers();
  if (fillMode) {
    if (answersJsonPath && existsSync(answersJsonPath)) {
      try {
        fillAnswers = JSON.parse(readFileSync(answersJsonPath, 'utf-8'));
      } catch (e) {
        console.log(JSON.stringify({ error: `Failed to parse answers JSON: ${e.message}`, manualUrl: jobUrl }));
        process.exit(1);
      }
    } else if (!answersJsonPath) {
      // Generate answers from profile
      fillAnswers = generateAnswers([], profile, formAnswers).answers;
    }
  }

  let browser;
  try {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-web-security',
      '--disable-features=BlockInsecurePrivateNetworkRequests',
      '--disable-features=ChromeWhatsNewUI',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-gpu',
      '--disable-gpu-compositing',
    ];

    // Under proot/Termux, Chromium's inherited-ICU-fd startup path breaks
    // ("Invalid file descriptor to ICU data received"). Point it at the
    // icudtl.dat on disk so it skips the fd mechanism entirely.
    try {
      const exePath = chromium.executablePath();
      if (exePath) launchArgs.push(`--icu-data-dir=${dirname(exePath)}`);
    } catch {}

    // Persistent per-user profile: cookies/login sessions survive between
    // runs, so portals that require an account (Internshala, Naukri,
    // LinkedIn, Indeed) only need ONE manual login before auto-fill works.
    // launchPersistentContext merges launch + context options in one call.
    const profileDir = join(userDir, '.pwprofile');
    let context;
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        headless,
        args: launchArgs,
        userAgent: getRandomUserAgent(),
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        timezoneId: 'Asia/Kolkata',
        geolocation: { latitude: 19.0760, longitude: 72.8777 },
        permissions: ['geolocation'],
      });
      browser = context.browser();
    } catch (profileErr) {
      // Profile dir corrupt or already locked by a concurrent run — fall back
      // to a fresh ephemeral context so auto-fill still works.
      try { mkdirSync(profileDir, { recursive: true }); } catch {}
      browser = await chromium.launch({ headless, args: launchArgs });
      context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        timezoneId: 'Asia/Kolkata',
        geolocation: { latitude: 19.0760, longitude: 72.8777 },
        permissions: ['geolocation'],
      });
    }

    const page = await context.newPage();

    // Seed the Google session captured from the app's one-time WebView login
    // (google-cookies.json), and hide Playwright automation markers so Google
    // and portals don't flag the browser.
    try { await context.addInitScript(stealthInitScript()); } catch {}
    const seeded = await seedGoogleCookies(context, userDir);
    if (seeded) console.error(`[seed] applied ${seeded} google cookies`);

    // Navigate with timeout
    try {
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      const atsType = detectAtsType(jobUrl);
      const nb = await browserlessExtract(jobUrl, profile, formAnswers);
      if (nb && nb.fields.length > 0) {
        console.log(JSON.stringify({
          success: true,
          mode: 'browserless',
          url: jobUrl,
          title: nb.title,
          company: companyOverride || nb.title.split(/[@|–—-]/).pop()?.trim() || nb.title,
          atsType: nb.atsType,
          fields: nb.fields,
          answers: nb.answers,
          pending_questions: nb.pendingQuestions,
          manual_apply_guide: nb.guide,
          manualUrl: jobUrl,
          message: nb.pendingQuestions.length > 0
            ? `Page couldn't be loaded in a browser, so the form was parsed from the raw HTML. ${nb.pendingQuestions.length} field(s) need your input before applying manually.`
            : "Page couldn't be loaded in a browser, so the form was parsed from the raw HTML. Use the manual guide to apply in your browser.",
        }, null, 2));
      } else {
        const guide = generateManualGuide(atsType, jobUrl, profile, []);
        console.log(JSON.stringify({
          error: `Navigation failed: ${e.message}`,
          atsType,
          manualUrl: jobUrl,
          reason: 'Could not load the page — site may be blocking automated access',
          instructions: 'Open the URL in your browser and apply manually.',
          manual_apply_guide: guide,
        }));
      }
      await browser.close();
      process.exit(0);
    }

    // Wait for SPA hydration
    await page.waitForTimeout(3000);

    const pageText = await page.evaluate(() => document.body?.innerText || '');

    // Detect ATS type from URL
    const atsType = detectAtsType(jobUrl);

    // Detect blocks — real challenge widget in DOM, visible block text, or bot cookies.
    // Visible-text scan avoids false positives from hidden CSS (e.g. .grecaptcha-badge).
    let botDetected = false;
    let botReason = '';
    const botWidget = await detectBotWidget(page);
    for (const pattern of BOT_DETECTION_PATTERNS.blockText) {
      if (pattern.test(pageText)) {
        botDetected = true;
        botReason = pattern.source ? `Matched: ${pattern.source}` : 'Bot challenge detected';
        break;
      }
    }
    if (!botDetected && botWidget) {
      botDetected = true;
      botReason = `Challenge widget: ${botWidget}`;
    }

    // Check for bot challenge cookies
    const challengeCookies = await checkBotCookies(page);

    if (botDetected || challengeCookies.length > 0) {
      const guide = generateManualGuide(atsType, jobUrl, profile, []);
      console.log(JSON.stringify({
        error: 'Bot challenge detected',
        atsType,
        manualUrl: jobUrl,
        reason: challengeCookies.length > 0
          ? `Challenge cookies found: ${challengeCookies.join(', ')}`
          : botReason || 'This site requires human verification (captcha/JS challenge)',
        instructions: 'Open the URL in your browser, complete the challenge, and apply manually.',
        manual_apply_guide: guide,
      }, null, 2));
      await browser.close();
      process.exit(0);
    }

    if (/sign in|log in|login|create.*account|register/i.test(pageText) &&
        !/apply|submit|resume/i.test(pageText)) {
      const guide = generateManualGuide(atsType, jobUrl, profile, []);
      console.log(JSON.stringify({
        error: 'Login wall detected',
        atsType,
        manualUrl: jobUrl,
        reason: 'This site requires login to view the application form',
        instructions: 'Open the URL in your browser, log in, and apply manually.',
        manual_apply_guide: guide,
      }, null, 2));
      await browser.close();
      process.exit(0);
    }

    // Expired/closed detection. Word-boundary the markers so Shine's
    // "Not Disclosed" salary doesn't trip "closed", and only declare an
    // expired posting when there is NO apply affordance on the page (a live
    // job with "2 days ago" + an Apply button must never be skipped).
    const hasApplyAffordance = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      return Array.from(document.querySelectorAll('a, button, [role="button"]'))
        .some((e) => vis(e) && /^\s*(apply|apply now|apply for|login to apply)\b/i.test((e.textContent || '').trim()));
    }).catch(() => false);
    const expiredRe = /no longer available|position filled|job (has been|is) (removed|filled|closed)|\bexpired\b|not found|\bclosed\b/i;
    if (!hasApplyAffordance && expiredRe.test(pageText)) {
      console.log(JSON.stringify({
        error: 'Posting expired',
        atsType,
        manualUrl: jobUrl,
        reason: 'This job posting appears to be expired or filled',
        instructions: 'This position is no longer available.',
      }));
      await browser.close();
      process.exit(0);
    }

    // Extract page title for company name
    const title = await page.title();
    const company = companyOverride || title.split(/[@|–—-]/).pop()?.trim() || title;

    // Click Apply button if present (reveals dynamic/SPA forms). May open a
    // new tab — formPage is whichever page ends up hosting the real form.
    const formPage = await clickApplyButton(page, context);

    if (fillMode) {
      // ── FILL MODE ──
      // Wait for the real form to render (SPA/dynamic forms hydrate after
      // the Apply click), then extract fields across all frames.
      await waitForFormFields(formPage);
      let fields = await extractFields(formPage);

      // NO FORM AT ALL → try to establish a portal session automatically
      // (Google OAuth preferred, stored creds fallback), then re-check. If a
      // real form still hasn't rendered, report an honest FAILURE with the
      // precise cause pinned — never a false green check.
      let loginVia = null;
      let authState = null;
      if (fields.length === 0) {
        // 0) Resume-upload-first onboarding (Shine, apna.co) — needs no login.
        fields = await uploadResumeFirst(formPage, userDir, company);
        if (fields.length > 0) loginVia = 'resume-upload';
      }
      if (fields.length === 0) {
        const wall = await detectLoginWall(formPage);
        const entry = await findAuthEntry(formPage);
        authState = await describeAuthState(formPage);
        if (wall || entry) {
          // 1) Portal creds vault (fallback — works headless, no popup)
          const creds = loadPortalCreds(userDir, jobUrl);
          if (creds && creds.password) {
            const r = await loginWithPortalCreds(formPage, creds);
            if (r.ok) {
              await waitForFormFields(formPage);
              const after = await extractFields(formPage);
              if (after.length > 0) { fields = after; loginVia = 'portal-creds'; }
            }
          }
          // 2) Google OAuth (preferred) — reuse the Gmail OAuth session
          if (fields.length === 0) {
            const g = await loginWithGoogleOAuth(formPage, context, profile.candidate?.email || profile.email || '');
            if (g.ok) {
              await waitForFormFields(formPage);
              const after = await extractFields(formPage);
              if (after.length > 0) { fields = after; loginVia = 'google-oauth'; }
            }
          }
        }
      }

      if (fields.length === 0) {
        const loginWall = await detectLoginWall(formPage);
        const screenshotDir = join(userDir, 'data', 'uploads');
        if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
        const shotPath = join(screenshotDir, `fill-${Date.now()}.png`);
        await formPage.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        await browser.close();
        const wallReason = loginWall
          ? `${atsType || 'This portal'} requires signing in before the application form renders (${loginWall}). Auto-fill needs an active account session — Google OAuth and stored portal login were attempted automatically. Log in on the site once (Google OAuth) and retry, or apply manually.`
          : 'No form fields detected — the application may be multi-step or rendered after further interaction (e.g. an iframe the page hasn\u2019t mounted yet).';
        console.log(JSON.stringify({
          success: false,
          mode: 'fill',
          url: jobUrl,
          company,
          atsType,
          fields: [],
          filled: [],
          skipped: [],
          cvAttached: false,
          screenshotPath: shotPath,
          loginWall: !!loginWall,
          loginVia,
          authState,
          error: `Could not fill form — 0 fields detected. ${wallReason}`,
          message: `⚠️ Could not fill form — 0 fields detected. ${wallReason}`,
          manualUrl: jobUrl,
          manual_apply_guide: generateManualGuide(atsType, jobUrl, profile, []),
          instructions: 'Open the URL in your browser and apply manually.',
        }, null, 2));
        process.exit(0);
      }

      // If we didn't have answers from file, generate from profile
      if (Object.keys(fillAnswers).length === 0) {
        fillAnswers = generateAnswers(fields, profile, formAnswers).answers;
      }

      // Fill the form
      const result = await fillForm(formPage, fillAnswers);

      // Attach CV if available — distinguish "no CV file" from "no upload field"
      const cvPath = resolveTailoredCv(company);
      let cvAttached = false;
      let cvNote = '';
      if (cvPath) {
        try {
          const fileInput = await formPage.$('input[type="file"]');
          if (fileInput) {
            await fileInput.setInputFiles(cvPath);
            cvAttached = true;
            cvNote = 'CV attached.';
          } else {
            cvNote = 'No file-upload field found on the form.';
          }
        } catch (e) {
          cvNote = `CV attach failed (${e.message}).`;
        }
      } else {
        cvNote = 'No CV PDF found — run "Generate CV" first, then retry.';
      }

      // Take screenshot
      const screenshotDir = join(userDir, 'data', 'uploads');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = join(screenshotDir, `fill-${Date.now()}.png`);
      await formPage.screenshot({ path: screenshotPath, fullPage: true });

      await browser.close();

      // 0 FIELDS FILLED → FAILURE, even though the form rendered. Looking
      // "done" when nothing was entered is worse than an honest error.
      if (result.filled.length === 0) {
        console.log(JSON.stringify({
          success: false,
          mode: 'fill',
          url: jobUrl,
          company,
          title: title.slice(0, 200),
          atsType,
          fields: fields.map(f => ({ id: f.id, label: f.label, required: f.required })),
          filled: [],
          skipped: result.skipped,
          cvAttached,
          screenshotPath,
          loginVia,
          error: `Could not fill any of ${fields.length} detected field(s) — answer keys did not match the form controls.`,
          message: `⚠️ Could not fill form — 0 of ${fields.length} fields filled. ${cvNote} Manual apply required.`,
          manualUrl: jobUrl,
          manual_apply_guide: generateManualGuide(atsType, jobUrl, profile, fields),
          instructions: 'Open the URL in your browser and apply manually.',
        }, null, 2));
        process.exit(0);
      }

      console.log(JSON.stringify({
        success: true,
        mode: 'fill',
        url: jobUrl,
        company,
        title: title.slice(0, 200),
        atsType,
        fields: fields.map(f => ({ id: f.id, label: f.label, required: f.required })),
        filled: result.filled,
        skipped: result.skipped,
        cvAttached,
        cvNote,
        screenshotPath,
        loginVia,
        message: cvAttached
          ? `Form filled (${result.filled.length}/${fields.length} fields) and CV attached. Review and submit manually.`
          : `Form filled (${result.filled.length}/${fields.length} fields). ${cvNote} Review and submit manually.`,
        manualUrl: jobUrl,
      }, null, 2));

    } else {
      // ── EXTRACT MODE (default) ──
      await waitForFormFields(formPage);
      const fields = await extractFields(formPage);
      const { answers, pendingQuestions } = generateAnswers(fields, profile, formAnswers);
      const cvPath = resolveTailoredCv(company);

      const screenshotDir = join(userDir, 'data', 'uploads');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = join(screenshotDir, `apply-${Date.now()}.png`);
      await formPage.screenshot({ path: screenshotPath, fullPage: true });

      await browser.close();

      const guide = generateManualGuide(atsType, jobUrl, profile, fields);
      console.log(JSON.stringify({
        success: true,
        mode: 'extract',
        url: jobUrl,
        title: title.slice(0, 200),
        company,
        atsType,
        fields,
        answers,
        pending_questions: pendingQuestions,
        cvPath,
        screenshotPath,
        manual_apply_guide: guide,
        message: pendingQuestions.length > 0
          ? `Form extracted. ${pendingQuestions.length} field(s) need your input before filling.`
          : 'Form extracted. Review answers, then fill via bridge-server /apply/fill endpoint.',
        manualUrl: jobUrl,
      }, null, 2));
    }

  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    const atsType = detectAtsType(jobUrl);
    // Browserless fallback: if the browser can't launch (TLS segment rejected
    // on ARM64 bionic, missing libs, sandbox errors), fetch + parse the HTML
    // directly so the user still gets answers + a manual apply guide.
    const nb = await browserlessExtract(jobUrl, profile, formAnswers);
    if (nb && nb.fields.length > 0) {
      console.log(JSON.stringify({
        success: true,
        mode: 'browserless',
        url: jobUrl,
        title: nb.title,
        company: companyOverride || nb.title.split(/[@|–—-]/).pop()?.trim() || nb.title,
        atsType: nb.atsType,
        fields: nb.fields,
        answers: nb.answers,
        pending_questions: nb.pendingQuestions,
        manual_apply_guide: nb.guide,
        manualUrl: jobUrl,
        browserError: e.message?.slice(0, 300),
        message: nb.pendingQuestions.length > 0
          ? `Browser couldn't launch, so the form was parsed from the page HTML instead. ${nb.pendingQuestions.length} field(s) need your input before applying manually.`
          : "Browser couldn't launch, so the form was parsed from the page HTML. Use the manual guide to apply in your browser.",
      }, null, 2));
    } else {
      const guide = nb ? nb.guide : generateManualGuide(atsType, jobUrl, profile, []);
      console.log(JSON.stringify({
        error: e.message,
        atsType,
        manualUrl: jobUrl,
        reason: `Unexpected error: ${e.message}`,
        instructions: 'Open the URL in your browser and apply manually.',
        manual_apply_guide: guide,
      }));
    }
  }
}

main();
