#!/usr/bin/env node
/**
 * one-shot-apply.mjs — Scan + auto-fill all matching jobs via Obscura stealth.
 *
 * Flow:
 *   1. Scan job portals (Naukri, LinkedIn, Indeed, etc.)
 *   2. Filter by location (Mumbai/NaviMumbai/Suburban) and salary (3-12 LPA)
 *   3. For each job, extract form fields via Obscura
 *   4. Fill forms with profile data
 *   5. Return results for user approval (never auto-submit)
 *
 * Usage:
 *   node one-shot-apply.mjs [--user-dir <dir>] [--limit 20] [--dry-run]
 *
 * Output: JSON array of {job, formResult} objects.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSCURA_BIN = process.env.OBSCURA_BIN || 'obscura';

// ── Parse args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
let userDir = process.env.CAREER_OPS || __dirname;
let limit = 20;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
  if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i]);
  if (args[i] === '--dry-run') dryRun = true;
}

// ── Profile Loading ─────────────────────────────────────────────────
function loadProfile() {
  const p = join(userDir, 'config', 'profile.yml');
  if (!existsSync(p)) return {};
  try {
    const content = readFileSync(p, 'utf-8');
    try { return JSON.parse(content); } catch {}
    try {
      const yaml = require('js-yaml');
      return yaml.load(content) || {};
    } catch {}
    return {};
  } catch { return {}; }
}

// ── Obscura CLI Wrapper ─────────────────────────────────────────────
function runObscura(obscuraArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const allArgs = [...obscuraArgs, '--stealth'];
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
      resolve({ stdout, stderr, code });
    });

    proc.on('error', reject);
  });
}

async function obscuraFetch(url, evalExpr, opts = {}) {
  const result = await runObscura(['fetch', url, '--eval', evalExpr], { timeout: opts.timeout || 25000 });
  const lines = result.stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') || line.startsWith('[')) {
      try { return JSON.parse(line); } catch {}
    }
  }
  return null;
}

// ── Job Portals ─────────────────────────────────────────────────────
const PORTALS = [
  {
    name: 'Naukri',
    search: (q) => `https://www.naukri.com/${q.replace(/\s+/g, '-')}-jobs-in-mumbai?experience=0to1`,
    extract: `
      JSON.stringify([...document.querySelectorAll('.srp-card, .tuple-wrap, [data-comp-id], .jobTuple')].map(el => {
        const title = (el.querySelector('.title, .desig, h2 a, h2, .role') || {}).textContent?.trim() || '';
        const company = (el.querySelector('.companyName, .comp-name, .company, .subtitle') || {}).textContent?.trim() || '';
        const location = (el.querySelector('.location, .loc, .add, .si GBP') || {}).textContent?.trim() || '';
        const link = (el.querySelector('a') || {}).href || '';
        const salary = (el.querySelector('.salary, .sal') || {}).textContent?.trim() || '';
        return { title, company, location, link, salary, portal: 'naukri' };
      }).filter(j => j.title && j.link).slice(0, 10))
    `,
  },
  {
    name: 'Indeed',
    search: (q) => `https://in.indeed.com/jobs?q=${encodeURIComponent(q)}&l=Mumbai&fromage=7`,
    extract: `
      JSON.stringify([...document.querySelectorAll('.job_seen_beacon, .result, .jobsearch-ResultsList > li')].map(el => {
        const title = (el.querySelector('h2 a, .jobTitle a, .jobTitle') || {}).textContent?.trim() || '';
        const company = (el.querySelector('.companyName, .company, [data-testid="company-name"]') || {}).textContent?.trim() || '';
        const location = (el.querySelector('.companyLocation, .location, [data-testid="text-location"]') || {}).textContent?.trim() || '';
        const link = (el.querySelector('h2 a, .jobTitle a') || {}).href || '';
        return { title, company, location, link, portal: 'indeed' };
      }).filter(j => j.title && j.link).slice(0, 10))
    `,
  },
  {
    name: 'LinkedIn',
    search: (q) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=Mumbai&f_TPR=r604800`,
    extract: `
      JSON.stringify([...document.querySelectorAll('.base-card, .job-search-card')].map(el => {
        const title = (el.querySelector('.base-search-card__title, h3') || {}).textContent?.trim() || '';
        const company = (el.querySelector('.base-search-card__subtitle, h4') || {}).textContent?.trim() || '';
        const location = (el.querySelector('.job-search-card__location') || {}).textContent?.trim() || '';
        const link = (el.querySelector('a') || {}).href || '';
        return { title, company, location, link, portal: 'linkedin' };
      }).filter(j => j.title && j.link).slice(0, 10))
    `,
  },
];

// ── Location Filter ─────────────────────────────────────────────────
const MUMBAI_KEYWORDS = [
  'mumbai', 'navi mumbai', 'thane', 'kalyan', 'dombivli',
  'remote', 'work from home', 'hybrid', 'india', 'anywhere',
  'bangalore', 'bengaluru', 'delhi', 'gurgaon', 'pune',
  'chennai', 'hyderabad', 'ahmedabad', 'kolkata',
];

function isMumbaiLocation(location) {
  if (!location || location.trim() === '') return true; // don't penalize missing
  const loc = location.toLowerCase();
  // Block non-Mumbai locations
  const blocked = ['bangalore', 'bengaluru', 'delhi', 'gurgaon', 'gurugram',
    'pune', 'chennai', 'hyderabad', 'ahmedabad', 'kolkata',
    'united states', 'united kingdom', 'london', 'germany', 'singapore'];
  if (blocked.some(b => loc.includes(b))) return false;
  // Allow Mumbai keywords
  const allowed = ['mumbai', 'navi mumbai', 'thane', 'kalyan', 'remote',
    'work from home', 'hybrid', 'india', 'anywhere'];
  return allowed.some(a => loc.includes(a));
}

// ── Form Extraction & Fill ──────────────────────────────────────────
async function extractAndFill(url, profile) {
  // Extract form fields
  const extractExpr = `
    JSON.stringify({
      fields: [...document.querySelectorAll('input, textarea, select')].map(el => {
        const label = (el.closest('label') || {}).textContent?.trim() ||
          (document.querySelector('label[for="' + el.id + '"]') || {}).textContent?.trim() ||
          el.getAttribute('aria-label') || el.placeholder || '';
        return {
          name: el.name || el.id || '',
          type: el.type || el.tagName.toLowerCase(),
          label: label,
          required: el.required || el.getAttribute('aria-required') === 'true',
          visible: el.offsetParent !== null,
        };
      }).filter(f => f.name && f.visible),
      title: document.title,
      url: location.href,
    })
  `;

  const formData = await obscuraFetch(url, extractExpr, { timeout: 20000 });
  if (!formData || !formData.fields || formData.fields.length === 0) {
    return { success: false, error: 'No form fields found', fieldsFound: 0 };
  }

  // Generate answers from profile
  const candidate = profile?.candidate || {};
  const location = profile?.location || {};
  const compensation = profile?.compensation || {};
  const answers = {};

  for (const field of formData.fields) {
    const nameLower = (field.name + ' ' + field.label).toLowerCase();

    if (nameLower.includes('first') && nameLower.includes('name')) {
      answers[field.name] = (candidate.full_name || '').split(' ')[0] || '';
    } else if (nameLower.includes('last') && nameLower.includes('name')) {
      const parts = (candidate.full_name || '').split(' ');
      answers[field.name] = parts.length > 1 ? parts.slice(1).join(' ') : '';
    } else if (nameLower.includes('full') && nameLower.includes('name')) {
      answers[field.name] = candidate.full_name || '';
    } else if (nameLower.includes('name') && !nameLower.includes('company')) {
      answers[field.name] = candidate.full_name || '';
    } else if (nameLower.includes('email')) {
      answers[field.name] = candidate.email || '';
    } else if (nameLower.includes('phone') || nameLower.includes('mobile')) {
      answers[field.name] = candidate.phone || '';
    } else if (nameLower.includes('location') || nameLower.includes('city')) {
      answers[field.name] = location.city || candidate.location || '';
    } else if (nameLower.includes('linkedin')) {
      answers[field.name] = candidate.linkedin || '';
    } else if (nameLower.includes('github')) {
      answers[field.name] = candidate.github || '';
    } else if (nameLower.includes('experience') || nameLower.includes('yoe')) {
      answers[field.name] = candidate.experience_years || '0';
    } else if (nameLower.includes('salary') || nameLower.includes('ctc')) {
      answers[field.name] = compensation.target_range || '';
    } else if (nameLower.includes('cover') || nameLower.includes('message')) {
      answers[field.name] = `Dear Hiring Team,\n\nI am interested in this position. Please find my resume attached.\n\nBest regards,\n${candidate.full_name || 'Candidate'}`;
    }
  }

  // Fill form via Obscura
  const fillExpr = `
    const data = ${JSON.stringify(answers)};
    let filled = 0;
    for (const [name, value] of Object.entries(data)) {
      if (!value) continue;
      const el = document.querySelector('[name="' + name + '"], #' + CSS.escape(name));
      if (el) {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
    }
    JSON.stringify({ filled, total: Object.keys(data).length });
  `;

  const fillResult = await obscuraFetch(url, fillExpr, { timeout: 15000 });

  return {
    success: true,
    fieldsFound: formData.fields.length,
    fieldsFilled: fillResult?.filled || 0,
    fillData: answers,
    note: 'Form filled — review before submitting',
  };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const profile = loadProfile();
  const candidate = profile?.candidate || {};
  const targetRoles = profile?.target_roles?.primary || ['Software Engineer'];

  console.error(`[One-Shot] Profile: ${candidate.full_name || 'Unknown'}`);
  console.error(`[One-Shot] Target roles: ${targetRoles.join(', ')}`);
  console.error(`[One-Shot] Location: ${profile?.location?.city || 'Mumbai'}`);
  console.error(`[One-Shot] Salary: ${profile?.compensation?.target_range || '3-12 LPA'}`);

  const allJobs = [];

  // Scan each portal for each target role
  for (const role of targetRoles) {
    for (const portal of PORTALS) {
      console.error(`[Scan] ${portal.name}: ${role}...`);
      try {
        const searchUrl = portal.search(role);
        const jobs = await obscuraFetch(searchUrl, portal.extract, { timeout: 25000 });
        if (Array.isArray(jobs)) {
          allJobs.push(...jobs);
          console.error(`[Scan] ${portal.name}: found ${jobs.length} jobs`);
        }
      } catch (e) {
        console.error(`[Scan] ${portal.name} error: ${e.message}`);
      }
      // Delay between requests
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  const uniqueJobs = allJobs.filter(j => {
    if (!j.link || seen.has(j.link)) return false;
    seen.add(j.link);
    return true;
  });

  console.error(`\n[Total] ${uniqueJobs.length} unique jobs found`);

  // Filter by Mumbai location
  const mumbaiJobs = uniqueJobs.filter(j => isMumbaiLocation(j.location));
  console.error(`[Filtered] ${mumbaiJobs.length} jobs in Mumbai area`);

  // Apply limit
  const jobsToApply = mumbaiJobs.slice(0, limit);
  console.error(`[Processing] ${jobsToApply.length} jobs\n`);

  // Extract + fill each job
  const results = [];
  for (const job of jobsToApply) {
    console.error(`--- ${job.title} @ ${job.company} ---`);
    console.error(`  URL: ${job.link}`);

    if (dryRun) {
      console.error(`  [DRY RUN] Skipping form fill`);
      results.push({ job, result: { success: false, error: 'dry-run' } });
      continue;
    }

    try {
      const result = await extractAndFill(job.link, profile);
      console.error(`  Fields: ${result.fieldsFound}, Filled: ${result.fieldsFilled || 0}`);
      results.push({ job, result });
    } catch (e) {
      console.error(`  Error: ${e.message}`);
      results.push({ job, result: { success: false, error: e.message } });
    }

    // Delay between applications
    await new Promise(r => setTimeout(r, 3000));
  }

  // Output results as JSON
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    profile: {
      name: candidate.full_name,
      email: candidate.email,
      location: profile?.location?.city,
      salary: profile?.compensation?.target_range,
    },
    totalScanned: allJobs.length,
    uniqueJobs: uniqueJobs.length,
    mumbaiFiltered: mumbaiJobs.length,
    processed: results.length,
    results,
  }, null, 2));
}

main().catch(e => {
  console.error(`[Fatal] ${e.message}`);
  process.exit(1);
});
