#!/usr/bin/env node
/**
 * obscura-apply.mjs — Obscura stealth-mode job application engine.
 *
 * Drop-in replacement for apply-job.mjs using Obscura CLI instead of Playwright.
 * Reads profile from config/profile.yml, fills forms via obscura fetch --eval,
 * supports ATS-specific field mapping, Google OAuth session seeding.
 *
 * Modes:
 *   --extract (default): Open URL, extract form fields + generate answers
 *   --fill: Fill form with answers via Obscura
 *   --session-save: Capture Google OAuth session from Obscura
 *   --session-load: Seed Obscura with saved Google cookies
 *
 * Usage:
 *   node obscura-apply.mjs <url> [--user-dir <dir>]
 *   node obscura-apply.mjs <url> --fill --answers-json <path> [--company <name>]
 *   node obscura-apply.mjs --session-save
 *   node obscura-apply.mjs --session-load
 *
 * Output: JSON to stdout (same format as apply-job.mjs).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSCURA_BIN = process.env.OBSCURA_BIN || 'obscura';

// ── Parse CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
let userDir = process.env.CAREER_OPS || __dirname;
let jobUrl = '';
let fillMode = false;
let extractMode = true;
let answersJsonPath = '';
let companyOverride = '';
let stealthMode = true; // always stealth by default
let sessionSaveMode = false;
let sessionLoadMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
  if (args[i] === '--fill') { fillMode = true; extractMode = false; }
  if (args[i] === '--extract') { extractMode = true; fillMode = false; }
  if (args[i] === '--answers-json' && args[i + 1]) answersJsonPath = args[++i];
  if (args[i] === '--company' && args[i + 1]) companyOverride = args[++i];
  if (args[i] === '--stealth') stealthMode = true;
  if (args[i] === '--no-stealth') stealthMode = false;
  if (args[i] === '--session-save') sessionSaveMode = true;
  if (args[i] === '--session-load') sessionLoadMode = true;
  if (args[i].startsWith('http')) jobUrl = args[i];
}

// ── ATS Platform Detection (same as apply-job.mjs) ──────────────────
const ATS_PLATFORMS = [
  { name: 'Greenhouse', patterns: ['boards.greenhouse.io', 'greenhouse.io', 'grnh.se'] },
  { name: 'Keka', patterns: ['keka.com', 'keka.'] },
  { name: 'Workday', patterns: ['myworkdayjobs.com', 'workday.com', 'wd5.myworkdayjobs.com'] },
  { name: 'Lever', patterns: ['lever.co', 'hire.lever.co'] },
  { name: 'Workable', patterns: ['workable.com', 'apply.workable.com'] },
  { name: 'Ashby', patterns: ['ashbyhq.com', 'jobs.ashbyhq.com'] },
  { name: 'Internshala', patterns: ['internshala.com'] },
  { name: 'Naukri', patterns: ['naukri.com'] },
  { name: 'Indeed', patterns: ['indeed.com', 'indeed.'] },
  { name: 'LinkedIn', patterns: ['linkedin.com/jobs'] },
  { name: 'Monster', patterns: ['monsterindia.com'] },
  { name: 'Foundit', patterns: ['foundit'] },
  { name: 'Instahyre', patterns: ['instahyre.com'] },
  { name: 'Cutshort', patterns: ['cutshort.io'] },
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

// ── ATS Known Field Patterns ────────────────────────────────────────
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
      'resume': 'cv',
      'cover_letter': 'cover_letter',
    },
  },
  Lever: {
    mapping: {
      'name': 'candidate.full_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'urls[linkedin]': 'candidate.linkedin',
      'urls[github]': 'candidate.github',
      'comments': 'cover_letter',
      'resume': 'cv',
    },
  },
  Workable: {
    mapping: {
      'full_name': 'candidate.full_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'linkedin': 'candidate.linkedin',
      'website': 'candidate.portfolio_url',
      'cover': 'cover_letter',
    },
  },
  Internshala: {
    mapping: {
      'name': 'candidate.full_name',
      'email': 'candidate.email',
      'mobile': 'candidate.phone',
      'city': 'candidate.location',
      'resume': 'cv',
      'cover': 'cover_letter',
    },
  },
  Ashby: {
    mapping: {
      'name': 'candidate.full_name',
      'email': 'candidate.email',
      'phone': 'candidate.phone',
      'linkedInUrl': 'candidate.linkedin',
      'resume': 'cv',
    },
  },
};

// ── Profile Loading ─────────────────────────────────────────────────
function loadProfile() {
  const p = join(userDir, 'config', 'profile.yml');
  if (!existsSync(p)) return {};
  try {
    const content = readFileSync(p, 'utf-8');
    // Try JSON first
    try { return JSON.parse(content); } catch {}
    // Try YAML
    try {
      const yaml = require('js-yaml');
      return yaml.load(content) || {};
    } catch {}
    return {};
  } catch { return {}; }
}

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

function resolveProfileValue(path, profile) {
  const parts = path.split('.');
  let val = profile;
  for (const p of parts) {
    if (val && typeof val === 'object' && p in val) val = val[p];
    else return '';
  }
  if (val && typeof val === 'string') return val;
  // Fallback: split full_name into first/last
  if (path === 'candidate.first_name') {
    const full = profile?.candidate?.full_name || profile?.candidate?.name || '';
    return full.split(' ')[0] || '';
  }
  if (path === 'candidate.last_name') {
    const full = profile?.candidate?.full_name || profile?.candidate?.name || '';
    const parts = full.split(' ');
    return parts.length > 1 ? parts.slice(1).join(' ') : '';
  }
  return '';
}

// ── Google OAuth Session ────────────────────────────────────────────
function loadGoogleCookies() {
  const p = join(userDir, 'google-cookies.json');
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.cookies)) return data.cookies;
    return [];
  } catch { return []; }
}

function saveGoogleCookies(cookies) {
  const p = join(userDir, 'google-cookies.json');
  writeFileSync(p, JSON.stringify({ cookies, savedAt: new Date().toISOString() }, null, 2));
}

// ── Obscura CLI Wrapper ─────────────────────────────────────────────
function runObscura(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const allArgs = [...args];
    if (stealthMode && !allArgs.includes('--stealth')) allArgs.push('--stealth');

    const proc = spawn(OBSCURA_BIN, allArgs, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...opts.env },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Obscura timeout after ${opts.timeout || 30000}ms`));
    }, opts.timeout || 30000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !opts.allowFail) {
        reject(new Error(`Obscura exit ${code}: ${stderr.slice(0, 300)}`));
      } else {
        resolve({ stdout, stderr, code });
      }
    });

    proc.on('error', reject);
  });
}

async function obscuraFetch(url, evalExpr, opts = {}) {
  const args = ['fetch', url, '--eval', evalExpr];
  const result = await runObscura(args, { timeout: opts.timeout || 25000 });
  // Parse JSON from last meaningful line
  const lines = result.stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') || line.startsWith('[')) {
      try { return JSON.parse(line); } catch {}
    }
  }
  return result.stdout.trim();
}

// ── Form Field Extraction ───────────────────────────────────────────
const EXTRACT_FIELDS_EXPR = `
  JSON.stringify({
    fields: [...document.querySelectorAll('input, textarea, select')].map(el => {
      const label = el.closest('label')?.textContent?.trim() ||
        document.querySelector('label[for="' + el.id + '"]')?.textContent?.trim() ||
        el.getAttribute('aria-label') || el.placeholder || '';
      return {
        name: el.name || el.id || '',
        type: el.type || el.tagName.toLowerCase(),
        placeholder: el.placeholder || '',
        label: label,
        required: el.required || el.getAttribute('aria-required') === 'true',
        options: el.tagName === 'SELECT' ? [...el.options].map(o => ({value: o.value, text: o.text})) : [],
        visible: el.offsetParent !== null,
      };
    }).filter(f => f.name && f.visible),
    title: document.title,
    url: location.href,
    hasGoogleLogin: !!document.querySelector('[data-provider="google"], [class*="google"], a[href*="accounts.google.com"]'),
    hasFileUpload: !!document.querySelector('input[type="file"]'),
  })
`;

// ── Extract Mode ────────────────────────────────────────────────────
async function extractFormFields(url) {
  const formData = await obscuraFetch(url, EXTRACT_FIELDS_EXPR, { timeout: 25000 });
  if (!formData || !formData.fields) {
    return { error: 'Could not extract form fields', url, fields: [] };
  }

  const atsType = detectAtsType(url);
  const profile = loadProfile();
  const formAnswers = loadFormAnswers();
  const known = ATS_KNOWN_PATTERNS[atsType];

  // Generate pre-filled answers from profile + form answers
  const answers = {};
  for (const field of formData.fields) {
    const nameLower = (field.name + ' ' + field.label + ' ' + field.placeholder).toLowerCase();

    // Check known ATS mapping first
    if (known?.mapping[field.name]) {
      const val = resolveProfileValue(known.mapping[field.name], profile);
      if (val) answers[field.name] = val;
      continue;
    }

    // Generic field detection
    if (nameLower.includes('first') && nameLower.includes('name')) {
      answers[field.name] = resolveProfileValue('candidate.first_name', profile) || (profile?.candidate?.full_name || '').split(' ')[0] || '';
    } else if (nameLower.includes('last') && nameLower.includes('name')) {
      answers[field.name] = resolveProfileValue('candidate.last_name', profile) || (profile?.candidate?.full_name || '').split(' ').slice(1).join(' ') || '';
    } else if (nameLower.includes('full') && nameLower.includes('name')) {
      answers[field.name] = resolveProfileValue('candidate.full_name', profile) || profile?.candidate?.name || '';
    } else if (nameLower.includes('name') && !nameLower.includes('company')) {
      answers[field.name] = resolveProfileValue('candidate.full_name', profile) || profile?.candidate?.name || '';
    } else if (nameLower.includes('email')) {
      answers[field.name] = resolveProfileValue('candidate.email', profile) || '';
    } else if (nameLower.includes('phone') || nameLower.includes('mobile')) {
      answers[field.name] = resolveProfileValue('candidate.phone', profile) || '';
    } else if (nameLower.includes('location') || nameLower.includes('city')) {
      answers[field.name] = resolveProfileValue('location.city', profile) || resolveProfileValue('candidate.location', profile) || '';
    } else if (nameLower.includes('linkedin')) {
      answers[field.name] = resolveProfileValue('candidate.linkedin', profile) || '';
    } else if (nameLower.includes('github')) {
      answers[field.name] = resolveProfileValue('candidate.github', profile) || '';
    } else if (nameLower.includes('experience') || nameLower.includes('yoe')) {
      answers[field.name] = formAnswers.experience || resolveProfileValue('candidate.experience_years', profile) || '0';
    } else if (nameLower.includes('salary') || nameLower.includes('ctc') || nameLower.includes('compensation')) {
      answers[field.name] = formAnswers.salary || resolveProfileValue('compensation.target_range', profile) || '';
    } else if (nameLower.includes('cover') || nameLower.includes('message') || nameLower.includes('additional')) {
      answers[field.name] = formAnswers.cover_letter || generateCoverLetter(profile);
    }
  }

  return {
    ats_type: atsType || 'unknown',
    url: formData.url || url,
    title: formData.title,
    fields: formData.fields,
    answers,
    hasGoogleLogin: formData.hasGoogleLogin,
    hasFileUpload: formData.hasFileUpload,
    confidence: known ? 'high' : 'low',
    notes: known ? `${atsType} ATS detected — pre-filled from profile` : 'Unknown ATS — generic field detection used',
  };
}

function generateCoverLetter(profile) {
  const name = resolveProfileValue('candidate.full_name', profile) || 'Candidate';
  const email = resolveProfileValue('candidate.email', profile) || '';
  const phone = resolveProfileValue('candidate.phone', profile) || '';
  return `Dear Hiring Team,

I am writing to express my interest in this position. I am a passionate software developer with hands-on experience in modern web technologies.

I would love the opportunity to contribute to your engineering team. Please find my resume attached.

Best regards,
${name}
${email}
${phone}`;
}

// ── Fill Mode ───────────────────────────────────────────────────────
async function fillForm(url, companyAnswers, company) {
  // First extract fields
  const extracted = await extractFormFields(url);
  if (extracted.error) return extracted;

  // Merge answers: extracted defaults + user overrides
  const mergedAnswers = { ...extracted.answers, ...companyAnswers };

  // Fill form via Obscura eval
  const fillExpr = `
    const data = ${JSON.stringify(mergedAnswers)};
    let filled = 0;
    let failed = [];
    for (const [name, value] of Object.entries(data)) {
      if (!value) continue;
      const el = document.querySelector('[name="' + name + '"], #' + CSS.escape(name));
      if (el) {
        try {
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          filled++;
        } catch (e) {
          failed.push({ name, error: e.message });
        }
      } else {
        failed.push({ name, error: 'element not found' });
      }
    }
    JSON.stringify({ filled, total: Object.keys(data).length, failed });
  `;

  const fillResult = await obscuraFetch(url, fillExpr, { timeout: 20000 });

  return {
    success: true,
    ats_type: extracted.ats_type,
    url,
    title: extracted.title,
    company: company || companyOverride,
    fieldsFound: extracted.fields.length,
    fieldsFilled: fillResult?.filled || 0,
    fillResult,
    note: 'Form filled — review before submitting. Use --submit to auto-submit.',
  };
}

// ── Session Save (capture Google cookies from Obscura) ──────────────
async function sessionSave() {
  const cookieExpr = `
    JSON.stringify({
      cookies: document.cookie.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return { name, value: rest.join('='), domain: location.hostname, path: '/' };
      }),
      url: location.href,
      ts: Date.now(),
    })
  `;

  const result = await obscuraFetch('https://accounts.google.com', cookieExpr, { timeout: 15000 });
  if (result && result.cookies) {
    saveGoogleCookies(result.cookies);
    return { success: true, cookiesSaved: result.cookies.length, url: result.url };
  }
  return { success: false, error: 'Could not capture cookies' };
}

// ── Session Load (seed Obscura with saved cookies) ──────────────────
// Note: Obscura CLI doesn't support cookie injection directly.
// This returns the cookies for manual injection via eval.
function sessionLoad() {
  const cookies = loadGoogleCookies();
  if (!cookies.length) return { success: false, error: 'No saved cookies found' };

  // Build cookie string for injection
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const injectExpr = `
    document.cookie = ${JSON.stringify(cookieStr)};
    JSON.stringify({ injected: ${cookies.length}, url: location.href });
  `;

  return { success: true, cookies: cookies.length, injectExpr };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  if (sessionSaveMode) {
    const result = await sessionSave();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (sessionLoadMode) {
    const result = sessionLoad();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!jobUrl) {
    console.log(JSON.stringify({
      error: 'URL required',
      usage: 'node obscura-apply.mjs <url> [--fill --answers-json <path>] [--user-dir <dir>] [--session-save] [--session-load]',
    }));
    process.exit(1);
  }

  let answers = {};
  if (answersJsonPath && existsSync(answersJsonPath)) {
    try {
      answers = JSON.parse(readFileSync(answersJsonPath, 'utf-8'));
    } catch {}
  }

  let result;
  if (fillMode) {
    result = await fillForm(jobUrl, answers, companyOverride);
  } else {
    result = await extractFormFields(jobUrl);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.log(JSON.stringify({ error: e.message, url: jobUrl }));
  process.exit(1);
});
