// contact-render.mjs — Render a job posting with headless Chromium and extract
// recruiter/application contact info the plain-HTTP path cannot see (SPA pages,
// Internshala/Naukri/Shine job boards render the contact email only in JS).
//
// Usage: node contact-render.mjs <url> [textLimit]
// Output: JSON { emails, phones, applicationEmails, pageText, url, error? }
//
// This is the multi-user email-first fallback: the Bridge Server's
// /email/draft and /auto-pipeline call it whenever fetchJdAndContact finds no
// application email in the raw HTML. Same engine choice as apply-job.mjs
// (patchright -> playwright -> playwright-core) so Termux/Android works.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.argv[2];
const textLimit = parseInt(process.argv[3] || '6000', 10);
if (!url) {
  console.log(JSON.stringify({ error: 'usage: node contact-render.mjs <url> [textLimit]' }));
  process.exit(1);
}

// ── Contact extraction (mirror of bridge-server extractJdContact) ──────
const NOISE_EMAIL = /example\.com|\.(png|jpe?g|gif|svg|webp)$|sentry|wixpress|\b(no-?reply|donotreply|do-not-reply|noreply|notifications|updates|bounce|mailer-daemon|postmaster)@|\d+@/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const APP_HINT_RE = /\b(apply|careers?|recruit(er|ing|ment)?|hr|hiring|jobs?|talents?|resume|cv|talent-?acq(uisition)?|join)\b/i;
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;

function extractContact(html, pageText) {
  const raw = `${html || ''}\n${pageText || ''}`;
  const seen = new Set();
  const emails = [];
  for (const m of raw.match(EMAIL_RE) || []) {
    const e = m.replace(/^mailto:/i, '').toLowerCase().trim();
    if (seen.has(e)) continue;
    if (NOISE_EMAIL.test(e)) continue;
    if (e.length > 60) continue;
    seen.add(e);
    emails.push(e);
  }
  const app = (e) => APP_HINT_RE.test(e);
  emails.sort((a, b) => (app(b) ? 1 : 0) - (app(a) ? 1 : 0));
  const phones = [...new Set((raw.match(PHONE_RE) || []).map((p) => p.replace(/\s+/g, ' ').trim()))].slice(0, 3);
  return { emails: emails.slice(0, 8), phones, applicationEmails: emails.filter(app).slice(0, 3) };
}

// ── Engine selection (same precedence as apply-job.mjs) ────────────────
async function pickChromium() {
  try {
    const pr = await import('patchright').catch(() => null);
    if (pr && pr.chromium) return { chromium: pr.chromium, engine: 'patchright' };
  } catch { /* fall through */ }
  try {
    const pw = await import('playwright');
    return { chromium: pw.chromium, engine: 'playwright' };
  } catch {
    const pw = await import('playwright-core');
    return { chromium: pw.chromium, engine: 'playwright-core' };
  }
}

const { chromium, engine } = await pickChromium();
console.error(`[contact-render] engine=${engine}`);

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const finalUrl = page.url();
  const html = await page.content().catch(() => '');
  const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const mailtoHrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute('href')).filter(Boolean)
  ).catch(() => []);
  const text = `${pageText}\n${mailtoHrefs.join('\n')}`.replace(/\s+/g, ' ').trim();

  const contact = extractContact(html, text);
  console.log(JSON.stringify({
    url: finalUrl || url,
    emails: contact.emails,
    phones: contact.phones,
    applicationEmails: contact.applicationEmails,
    pageText: text.slice(0, textLimit),
  }));
} catch (e) {
  console.log(JSON.stringify({ error: e.message, url }));
} finally {
  if (browser) await browser.close().catch(() => {});
}
