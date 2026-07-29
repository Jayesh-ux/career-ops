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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
let userDir = process.env.CAREER_OPS || __dirname;
let headless = false;
let jobUrl = '';
let fillMode = false;
let answersJsonPath = '';
let companyOverride = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
  if (args[i] === '--headless') headless = true;
  if (args[i] === '--fill') fillMode = true;
  if (args[i] === '--answers-json' && args[i + 1]) answersJsonPath = args[++i];
  if (args[i] === '--company' && args[i + 1]) companyOverride = args[++i];
  if (args[i].startsWith('http')) jobUrl = args[i];
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
    // Simple YAML parser for flat key: value pairs
    const result = {};
    let currentSection = result;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      const kvMatch = trimmed.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        const [, key, val] = kvMatch;
        if (indent === 0) {
          currentSection = result;
          result[key] = val.replace(/^["']|["']$/g, '') || undefined;
        } else {
          currentSection[key] = val.replace(/^["']|["']$/g, '') || undefined;
        }
      }
    }
    return result;
  } catch { return {}; }
}

function loadCv() {
  const p = join(userDir, 'cv.md');
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

function resolveTailoredCv(company) {
  const outputDir = join(userDir, 'output');
  if (!existsSync(outputDir)) return null;

  const slug = (company || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const files = readdirSync(outputDir)
    .filter(f => f.endsWith('.pdf'))
    .map(f => ({ name: f, time: statSync(join(outputDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  for (const f of files) {
    if (f.name.toLowerCase().includes(slug)) return join(outputDir, f.name);
  }
  for (const f of files) {
    if (f.name.includes('generic')) return join(outputDir, f.name);
  }
  return null;
}

// ── Extract fields (default mode) ───────────────────────────────────

async function extractFields(page) {
  return page.evaluate(() => {
    const result = [];
    const inputs = document.querySelectorAll('input, textarea, select, [role="combobox"]');
    for (const el of inputs) {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
      if (el.offsetParent === null) continue;

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
}

function generateAnswers(fields, profile) {
  const answers = {};
  const c = profile.candidate || profile;
  for (const field of fields) {
    const l = (field.label || '').toLowerCase();
    if (l.includes('name') && !l.includes('company')) {
      answers[field.id] = c.full_name || c.name || '';
    } else if (l.includes('email')) {
      answers[field.id] = c.email || '';
    } else if (l.includes('phone') || l.includes('mobile')) {
      answers[field.id] = c.phone || '';
    } else if (l.includes('location') || l.includes('city')) {
      answers[field.id] = profile.location?.city || profile.location || '';
    } else if (l.includes('linkedin')) {
      answers[field.id] = c.linkedin || '';
    } else if (l.includes('portfolio') || l.includes('website') || l.includes('github')) {
      answers[field.id] = c.portfolio || c.github || '';
    } else if (l.includes('experience') || l.includes('years')) {
      answers[field.id] = c.experience_years || '';
    } else if (l.includes('salary') || l.includes('expected') || l.includes('ctc')) {
      answers[field.id] = profile.compensation?.target_range || '';
    } else if (l.includes('cover') || l.includes('message') || l.includes('additional')) {
      answers[field.id] = `Dear Hiring Team,\n\nI am interested in this role and believe my skills are a strong match. I have attached my resume for your review.\n\nBest regards,\n${c.full_name || c.name || 'Candidate'}`;
    }
  }
  return answers;
}

// ── Fill form (--fill mode) ─────────────────────────────────────────

async function fillForm(page, answers) {
  const filled = [];
  const skipped = [];

  for (const [fieldId, value] of Object.entries(answers)) {
    if (!value) { skipped.push(fieldId); continue; }
    try {
      // Try by id first, then by name
      let el = await page.$(`#${CSS.escape(fieldId)}`);
      if (!el) el = await page.$(`[name="${fieldId}"]`);
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

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const profile = loadProfile();
  const cv = loadCv();

  // Check if Playwright is available
  let chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
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
      fillAnswers = generateAnswers([], profile);
    }
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // Navigate with timeout
    try {
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(JSON.stringify({
        error: `Navigation failed: ${e.message}`,
        manualUrl: jobUrl,
        reason: 'Could not load the page — site may be blocking automated access',
        instructions: 'Open the URL in your browser and apply manually.',
      }));
      await browser.close();
      process.exit(0);
    }

    // Wait for SPA hydration
    await page.waitForTimeout(3000);

    const pageContent = await page.content();
    const pageText = await page.evaluate(() => document.body?.innerText || '');

    // Detect blocks
    if (/captcha|recaptcha|hcaptcha|turnstile|verify.*human|bot.*detect/i.test(pageContent)) {
      console.log(JSON.stringify({
        error: 'Bot challenge detected',
        manualUrl: jobUrl,
        reason: 'This site requires human verification (captcha)',
        instructions: 'Open the URL in your browser, complete the captcha, and apply manually.',
      }));
      await browser.close();
      process.exit(0);
    }

    if (/sign in|log in|login|create.*account|register/i.test(pageText) &&
        !/apply|submit|resume/i.test(pageText)) {
      console.log(JSON.stringify({
        error: 'Login wall detected',
        manualUrl: jobUrl,
        reason: 'This site requires login to view the application form',
        instructions: 'Open the URL in your browser, log in, and apply manually.',
      }));
      await browser.close();
      process.exit(0);
    }

    if (/no longer available|position filled|expired|closed|not found/i.test(pageText)) {
      console.log(JSON.stringify({
        error: 'Posting expired',
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

    if (fillMode) {
      // ── FILL MODE ──
      // Extract fields first to get proper IDs
      const fields = await extractFields(page);

      // If we didn't have answers from file, generate from profile
      if (Object.keys(fillAnswers).length === 0) {
        fillAnswers = generateAnswers(fields, profile);
      }

      // Fill the form
      const result = await fillForm(page, fillAnswers);

      // Attach CV if available
      const cvPath = resolveTailoredCv(company);
      let cvAttached = false;
      if (cvPath) {
        try {
          const fileInput = await page.$('input[type="file"]');
          if (fileInput) {
            await fileInput.setInputFiles(cvPath);
            cvAttached = true;
          }
        } catch { /* no file input or attach failed */ }
      }

      // Take screenshot
      const screenshotDir = join(userDir, 'data', 'uploads');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = join(screenshotDir, `fill-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      await browser.close();

      console.log(JSON.stringify({
        success: true,
        mode: 'fill',
        url: jobUrl,
        company,
        title: title.slice(0, 200),
        filled: result.filled,
        skipped: result.skipped,
        cvAttached,
        screenshotPath,
        message: cvAttached
          ? `Form filled (${result.filled.length} fields) and CV attached. Review and submit manually.`
          : `Form filled (${result.filled.length} fields). No CV file found to attach. Review and submit manually.`,
        manualUrl: jobUrl,
      }));

    } else {
      // ── EXTRACT MODE (default) ──
      const fields = await extractFields(page);
      const answers = generateAnswers(fields, profile);
      const cvPath = resolveTailoredCv(company);

      const screenshotDir = join(userDir, 'data', 'uploads');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = join(screenshotDir, `apply-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      await browser.close();

      console.log(JSON.stringify({
        success: true,
        mode: 'extract',
        url: jobUrl,
        title: title.slice(0, 200),
        company,
        fields,
        answers,
        cvPath,
        screenshotPath,
        message: 'Form extracted. Review answers, then fill via bridge-server /apply/fill endpoint.',
        manualUrl: jobUrl,
      }, null, 2));
    }

  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    console.log(JSON.stringify({
      error: e.message,
      manualUrl: jobUrl,
      reason: `Unexpected error: ${e.message}`,
      instructions: 'Open the URL in your browser and apply manually.',
    }));
  }
}

main();
