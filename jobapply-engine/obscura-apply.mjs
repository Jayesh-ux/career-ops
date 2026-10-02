/**
 * obscura-apply.mjs — Obscura stealth-mode job application engine
 *
 * Replaces Playwright for job portal form filling.
 * Uses Obscura's built-in stealth mode to bypass anti-bot detection.
 *
 * Modes:
 *   --scan: Discover jobs from portals (Naukri, LinkedIn, Indeed, etc.)
 *   --apply: Auto-fill application forms with stealth
 *   --session: Capture/restore Google OAuth sessions
 *   --one-shot: Apply to ALL pending jobs in one go
 *
 * Usage:
 *   node obscura-apply.mjs --scan --location mumbai --salary 3-12
 *   node obscura-apply.mjs --apply --url <job_url>
 *   node obscura-apply.mjs --one-shot
 *   node obscura-apply.mjs --session --save <path>
 *   node obscura-apply.mjs --session --load <path>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSCURA_BIN = process.env.OBSCURA_BIN || 'obscura';
const SESSION_DIR = join(__dirname, 'sessions');
const DATA_DIR = join(__dirname, '..', 'data');
const RESUME_DIR = '/sdcard/jobapply';

// ─── Candidate Info (from submit-all.mjs) ───────────────────────────
const CANDIDATE = {
  name: 'Jayesh Singh',
  email: 'hsinghjayesh@gmail.com',
  phone: '+91-7821816193',
  location: 'Kalyan, Mumbai',
  experience: 'Fresher / 1 year internship',
  skills: ['Java', 'Spring Boot', 'React.js', 'Node.js', 'PostgreSQL', 'TypeScript', 'Python'],
  education: 'B.E. Information Technology, Mumbai University',
};

// ─── Obscura CLI helpers ────────────────────────────────────────────

function runObscura(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(OBSCURA_BIN, args, {
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
        reject(new Error(`Obscura exit ${code}: ${stderr.slice(0, 200)}`));
      } else {
        resolve({ stdout, stderr, code });
      }
    });

    proc.on('error', reject);
  });
}

async function obscuraFetch(url, evalExpr, opts = {}) {
  const args = ['fetch', url, '--eval', evalExpr];
  if (opts.stealth) args.push('--stealth');
  if (opts.userAgent) args.push('--user-agent', opts.userAgent);
  const result = await runObscura(args, { timeout: opts.timeout || 20000 });
  // Parse JSON from last line of stdout (after "Fetching..." and "Page loaded..." lines)
  const lines = result.stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') || line.startsWith('[')) {
      try { return JSON.parse(line); } catch {}
    }
  }
  return result.stdout.trim();
}

// ─── Session Management ─────────────────────────────────────────────

function getSessionPath(name) {
  return join(SESSION_DIR, `${name}.json`);
}

async function captureSession(name) {
  mkdirSync(SESSION_DIR, { recursive: true });
  // Use obscura with stealth to capture cookies and localStorage
  const result = await runObscura([
    'fetch', 'https://accounts.google.com', '--stealth',
    '--eval', 'JSON.stringify({cookies: document.cookie, url: location.href, ts: Date.now()})'
  ], { timeout: 15000, allowFail: true });

  const lines = result.stdout.trim().split('\n');
  let data = { cookies: '', url: '', ts: Date.now(), name };
  for (let i = lines.length - 1; i >= 0; i--) {
    try { data = { ...data, ...JSON.parse(lines[i].trim()) }; break; } catch {}
  }

  const path = getSessionPath(name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`Session saved: ${path}`);
  return data;
}

function loadSession(name) {
  const path = getSessionPath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ─── Job Portal Scrapers (Obscura stealth) ──────────────────────────

const PORTALS = {
  naukri: {
    name: 'Naukri',
    searchUrl: (q, loc) => `https://www.naukri.com/${q}-jobs-in-${loc}?experience=0to1& salary=3to12lpa`,
    extractJobs: `
      JSON.stringify([...document.querySelectorAll('.srp-card, .tuple-wrap, [data-comp-id]')].map(el => {
        const title = el.querySelector('.title, .desig, h2 a, h2')?.textContent?.trim() || '';
        const company = el.querySelector('.companyName, .comp-name, .company')?.textContent?.trim() || '';
        const location = el.querySelector('.location, .loc, .add')?.textContent?.trim() || '';
        const link = el.querySelector('a')?.href || '';
        const salary = el.querySelector('.salary, .sal')?.textContent?.trim() || '';
        return { title, company, location, link, salary, portal: 'naukri' };
      }).filter(j => j.title && j.link))
    `,
  },
  indeed: {
    name: 'Indeed',
    searchUrl: (q, loc) => `https://in.indeed.com/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(loc)}&fromage=7`,
    extractJobs: `
      JSON.stringify([...document.querySelectorAll('.job_seen_beacon, .result, .jobsearch-ResultsList > li')].map(el => {
        const title = el.querySelector('h2 a, .jobTitle a, .jobTitle')?.textContent?.trim() || '';
        const company = el.querySelector('.companyName, .company, [data-testid="company-name"]')?.textContent?.trim() || '';
        const location = el.querySelector('.companyLocation, .location, [data-testid="text-location"]')?.textContent?.trim() || '';
        const link = el.querySelector('h2 a, .jobTitle a')?.href || '';
        return { title, company, location, link, portal: 'indeed' };
      }).filter(j => j.title && j.link))
    `,
  },
  linkedin: {
    name: 'LinkedIn',
    searchUrl: (q, loc) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=${encodeURIComponent(loc)}&f_TPR=r604800`,
    extractJobs: `
      JSON.stringify([...document.querySelectorAll('.base-card, .job-search-card')].map(el => {
        const title = el.querySelector('.base-search-card__title, h3')?.textContent?.trim() || '';
        const company = el.querySelector('.base-search-card__subtitle, h4')?.textContent?.trim() || '';
        const location = el.querySelector('.job-search-card__location')?.textContent?.trim() || '';
        const link = el.querySelector('a')?.href || '';
        return { title, company, location, link, portal: 'linkedin' };
      }).filter(j => j.title && j.link))
    `,
  },
  instahyre: {
    name: 'Instahyre',
    searchUrl: () => `https://www.instahyre.com/search/?location=Mumbai&role=developer`,
    extractJobs: `
      JSON.stringify([...document.querySelectorAll('.job-card, .opportunity-card')].map(el => {
        const title = el.querySelector('.job-title, h3')?.textContent?.trim() || '';
        const company = el.querySelector('.company-name, h4')?.textContent?.trim() || '';
        const location = el.querySelector('.location')?.textContent?.trim() || '';
        const link = el.querySelector('a')?.href || '';
        return { title, company, location, link, portal: 'instahyre' };
      }).filter(j => j.title))
    `,
  },
};

async function scanPortal(portalKey, query, location) {
  const portal = PORTALS[portalKey];
  if (!portal) throw new Error(`Unknown portal: ${portalKey}`);

  const url = portal.searchUrl(query, location);
  console.log(`[Scan] ${portal.name}: ${url}`);

  try {
    const jobs = await obscuraFetch(url, portal.extractJobs, {
      stealth: true,
      timeout: 25000,
    });
    console.log(`[Scan] ${portal.name}: found ${(jobs || []).length} jobs`);
    return Array.isArray(jobs) ? jobs : [];
  } catch (e) {
    console.error(`[Scan] ${portal.name} error: ${e.message}`);
    return [];
  }
}

// ─── Job Application (Obscura stealth form fill) ────────────────────

async function applyToJob(url, answers = {}) {
  console.log(`[Apply] Opening: ${url}`);

  // Step 1: Extract form fields
  const fieldsExpr = `
    JSON.stringify({
      fields: [...document.querySelectorAll('input, textarea, select')].map(el => ({
        name: el.name || el.id || el.placeholder || '',
        type: el.type || el.tagName.toLowerCase(),
        placeholder: el.placeholder || '',
        label: el.closest('label')?.textContent?.trim() || '',
        required: el.required || el.getAttribute('aria-required') === 'true',
        options: el.tagName === 'SELECT' ? [...el.options].map(o => ({value: o.value, text: o.text})) : [],
      })).filter(f => f.name),
      title: document.title,
      url: location.href,
    })
  `;

  const formData = await obscuraFetch(url, fieldsExpr, { stealth: true, timeout: 20000 });
  if (!formData || !formData.fields) {
    console.log('[Apply] Could not extract form fields');
    return { success: false, error: 'No form fields found' };
  }

  console.log(`[Apply] Found ${formData.fields.length} fields on: ${formData.title}`);

  // Step 2: Generate answers based on CANDIDATE info
  const fillData = {};
  for (const field of formData.fields) {
    const nameLower = (field.name + field.label + field.placeholder).toLowerCase();

    if (nameLower.includes('first') && nameLower.includes('name')) fillData[field.name] = CANDIDATE.name.split(' ')[0];
    else if (nameLower.includes('last') && nameLower.includes('name')) fillData[field.name] = CANDIDATE.name.split(' ').slice(1).join(' ');
    else if (nameLower.includes('full') && nameLower.includes('name')) fillData[field.name] = CANDIDATE.name;
    else if (nameLower.includes('name') && !nameLower.includes('company')) fillData[field.name] = CANDIDATE.name;
    else if (nameLower.includes('email')) fillData[field.name] = CANDIDATE.email;
    else if (nameLower.includes('phone') || nameLower.includes('mobile')) fillData[field.name] = CANDIDATE.phone;
    else if (nameLower.includes('location') || city in nameLower) fillData[field.name] = CANDIDATE.location;
    else if (nameLower.includes('experience')) fillData[field.name] = answers.experience || '0';
    else if (nameLower.includes('linkedin')) fillData[field.name] = answers.linkedin || `https://linkedin.com/in/${CANDIDATE.name.toLowerCase().replace(/\s+/g, '-')}`;
    else if (nameLower.includes('github')) fillData[field.name] = answers.github || `https://github.com/Jayesh-ux`;
    else if (nameLower.includes('portfolio') || nameLower.includes('website')) fillData[field.name] = answers.website || '';
    else if (nameLower.includes('cover') || nameLower.includes('message') || nameLower.includes('additional')) fillData[field.name] = answers.cover || generateCoverLetter();
    else if (answers[field.name]) fillData[field.name] = answers[field.name];
  }

  // Step 3: Fill form via Obscura eval
  const fillExpr = `
    const data = ${JSON.stringify(fillData)};
    let filled = 0;
    for (const [name, value] of Object.entries(data)) {
      const el = document.querySelector('[name="' + name + '"], #' + name);
      if (el) {
        el.value = value;
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        filled++;
      }
    }
    JSON.stringify({filled, total: Object.keys(data).length, fields: Object.keys(data)});
  `;

  const fillResult = await obscuraFetch(url, fillExpr, { stealth: true, timeout: 15000 });
  console.log(`[Apply] Fill result:`, fillResult);

  return {
    success: true,
    url,
    formTitle: formData.title,
    fieldsFound: formData.fields.length,
    fieldsFilled: fillResult?.filled || 0,
    fillData,
    note: 'Form filled — DO NOT auto-submit. Review and submit manually.',
  };
}

function generateCoverLetter() {
  return `Dear Hiring Team,

I am writing to express my interest in this position. I hold a B.E. in Information Technology from Mumbai University with hands-on experience in Java, Spring Boot, React.js, Node.js, and PostgreSQL.

During my internship at Qyuki Digital Media, I built production applications using modern web technologies. I developed Fair Pay Solution, a full-stack platform with PostgreSQL and payment integration, and Career Grid, a Spring Boot microservices backend deployed on AWS.

I am based in Kalyan (Mumbai suburban) and available for immediate joining. I would love to contribute to your engineering team.

Best regards,
Jayesh Singh
hsinghjayesh@gmail.com
+91-7821816193`;
}

// ─── One-Shot Apply ─────────────────────────────────────────────────

async function oneShotApply() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  ONE-SHOT APPLY — Obscura Stealth Engine');
  console.log('═══════════════════════════════════════════════\n');

  // Step 1: Scan all portals
  const queries = ['software engineer', 'full stack developer', 'react developer', 'node js developer', 'java developer', 'frontend developer'];
  const location = 'mumbai';
  const allJobs = [];

  for (const q of queries) {
    for (const portalKey of Object.keys(PORTALS)) {
      const jobs = await scanPortal(portalKey, q, location);
      allJobs.push(...jobs);
      // Small delay between requests
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  const uniqueJobs = allJobs.filter(j => {
    if (seen.has(j.link)) return false;
    seen.add(j.link);
    return true;
  });

  console.log(`\n[Total] ${uniqueJobs.length} unique jobs found\n`);

  // Step 2: Filter by location (Mumbai/NaviMumbai/Suburban)
  const mumbaiKeywords = ['mumbai', 'navi mumbai', 'thane', 'kalyan', 'dombivli', 'remote', 'work from home', 'hybrid', 'india'];
  const filteredJobs = uniqueJobs.filter(j => {
    const loc = (j.location || '').toLowerCase();
    return !loc || mumbaiKeywords.some(k => loc.includes(k));
  });

  console.log(`[Filtered] ${filteredJobs.length} jobs in Mumbai area\n`);

  // Step 3: Try to apply to each (fill form, don't submit)
  const results = [];
  for (const job of filteredJobs.slice(0, 20)) { // Limit to 20 for safety
    console.log(`\n--- Applying: ${job.title} @ ${job.company} ---`);
    try {
      const result = await applyToJob(job.link);
      results.push({ ...job, result });
    } catch (e) {
      results.push({ ...job, result: { success: false, error: e.message } });
    }
    // Delay between applications
    await new Promise(r => setTimeout(r, 3000));
  }

  // Step 4: Save results
  mkdirSync(DATA_DIR, { recursive: true });
  const reportPath = join(DATA_DIR, `apply-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalScanned: allJobs.length,
    uniqueJobs: uniqueJobs.length,
    mumbaiFiltered: filteredJobs.length,
    applied: results.length,
    results,
  }, null, 2));

  console.log(`\n[Report] Saved to: ${reportPath}`);
  console.log(`[Done] Applied to ${results.filter(r => r.result?.success).length}/${results.length} jobs`);
  return results;
}

// ─── Main CLI ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args.find(a => a.startsWith('--'))?.replace('--', '');

switch (mode) {
  case 'scan': {
    const location = args.includes('--location') ? args[args.indexOf('--location') + 1] : 'mumbai';
    const query = args.includes('--query') ? args[args.indexOf('--query') + 1] : 'software engineer';
    for (const portalKey of Object.keys(PORTALS)) {
      const jobs = await scanPortal(portalKey, query, location);
      console.log(JSON.stringify(jobs, null, 2));
    }
    break;
  }

  case 'apply': {
    const url = args[args.indexOf('--url') + 1];
    if (!url) { console.error('--url required'); process.exit(1); }
    const result = await applyToJob(url);
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case 'one-shot': {
    await oneShotApply();
    break;
  }

  case 'session': {
    if (args.includes('--save')) {
      const name = args[args.indexOf('--save') + 1] || 'google';
      await captureSession(name);
    } else if (args.includes('--load')) {
      const name = args[args.indexOf('--load') + 1] || 'google';
      const session = loadSession(name);
      console.log(session ? JSON.stringify(session, null, 2) : 'No session found');
    } else {
      console.log('Usage: --session --save <name> | --session --load <name>');
    }
    break;
  }

  default:
    console.log(`
Usage: node obscura-apply.mjs <mode> [options]

Modes:
  --scan                    Scan job portals
    --location <city>       Location filter (default: mumbai)
    --query <keywords>      Search query (default: software engineer)

  --apply                   Apply to a specific job
    --url <job_url>         Job posting URL

  --one-shot                Scan + Apply to all pending jobs

  --session                 Manage Google OAuth sessions
    --save <name>           Capture current session
    --load <name>           Load saved session
`);
}
