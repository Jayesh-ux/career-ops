#!/usr/bin/env node
/**
 * login-session.mjs — interactive one-time portal login session.
 *
 * Launches the user's persistent browser profile (.pwprofile) so a Google
 * OAuth sign-in done here is remembered by every future auto-fill run.
 * Serves a tiny HTTP control surface (screenshot + tap/type/navigate) that
 * the Android app renders as a live remote browser view.
 *
 * Usage:
 *   node login-session.mjs --port <n> --user-dir <dir> [--url <url>]
 *
 * HTTP endpoints:
 *   GET  /state       → { url, title, width, height, screenshot(b64), hasGoogle, formVisible, accounts[], ready }
 *   POST /tap         → { x, y }
 *   POST /type        → { text }
 *   POST /account     → { email }  (tap a specific account in the chooser)
 *   POST /navigate    → { url }
 *   POST /back
 *   POST /finish      → { success, googleSession, cookies }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Termux/Android compatibility — same preamble as apply-job.mjs.
if (process.platform === 'android') {
  Object.defineProperty(process, 'platform', { value: 'linux' });
}
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
    } catch { /* non-fatal */ }
  }
  cleanReady = hasBrowser(CLEAN_BROWSERS_DIR);
}
if (cleanReady) process.env.PLAYWRIGHT_BROWSERS_PATH = CLEAN_BROWSERS_DIR;
else if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const src = l2sCandidates.find(hasBrowser);
  if (src) process.env.PLAYWRIGHT_BROWSERS_PATH = src;
}

const args = process.argv.slice(2);
let port = 8799;
let userDir = process.env.CAREER_OPS || __dirname;
let startUrl = '';
let emailHint = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) port = parseInt(args[i + 1], 10);
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
  if (args[i] === '--url' && args[i + 1]) startUrl = args[++i];
  if (args[i] === '--email' && args[i + 1]) emailHint = args[++i];
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

let chromium;
let browser;
let context;
let page;
let ready = false;
let closing = false;
let lastAutoAction = '';

// Auto-drive Google's sign-in:
//   1. pre-fill the email and click Continue on the identifier page,
//   2. approve the portal's OAuth consent screen.
// The account chooser (when the profile already has accounts) is left for the
// user to pick via the app's "tap to sign in" chips — we never auto-select an
// account, mirroring the IMAP/Gmail account picker UX.
// Guards each step so it never fights the user or repeats an action.
async function autoDrive() {
  if (!page || closing || page.isClosed()) return;
  let url = '';
  try { url = page.url(); } catch { return; }
  if (!/accounts\.google\.com/.test(url)) return;

  let sig = '';
  try {
    sig = await page.evaluate(() => {
      const idEl = document.querySelector('input[name="identifier"]') || document.querySelector('#identifierId');
      return `${location.pathname}|${!!idEl}|${idEl ? (idEl.value || '').length : 0}|${location.search}`;
    }).catch(() => '');
  } catch { return; }
  if (!sig || sig === lastAutoAction) return;
  const sigForAction = sig;

  // 1) Email field → fill + Continue.
  if (emailHint) {
    const did = await page.evaluate((email) => {
      const idEl = document.querySelector('input[name="identifier"]') || document.querySelector('#identifierId');
      if (!idEl) return false;
      const r = idEl.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (!idEl.value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(idEl, email);
        idEl.dispatchEvent(new Event('input', { bubbles: true }));
        idEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const next = document.querySelector('#identifierNext, button[jsname="LgbsSe"]');
      if (next) {
        try { next.scrollIntoViewIfNeeded(); } catch {}
        next.click();
      }
      return true;
    }, emailHint).catch(() => false);
    if (did) { lastAutoAction = sigForAction; return; }
  }

  // 2) Account chooser → do NOT auto-select; the user taps an account in the
  //    app's chips. But if we land here with the email already in a password
  //    field, do nothing and wait. (No action taken — user chooses.)

  // 3) OAuth consent → approve once.
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 2500) : '').catch(() => '');
  if (/wants to access your google account|has access to your google account|allow .* to|permissions/i.test(bodyText)) {
    const approved = await page.evaluate(() => {
      const direct = document.querySelector('#submit_approve_access');
      if (direct) { try { direct.scrollIntoViewIfNeeded(); } catch {}; direct.click(); return true; }
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const target = btns.find((b) => {
        const t = (b.textContent || '').trim().toLowerCase();
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (t === 'continue' || t === 'allow' || t === 'allow access');
      });
      if (!target) return false;
      try { target.scrollIntoViewIfNeeded(); } catch {}
      target.click();
      return true;
    }).catch(() => false);
    if (approved) lastAutoAction = sigForAction;
  }
}

async function snapshot() {
  const state = {
    url: page ? page.url() : '',
    title: page ? (await page.title().catch(() => '')) : '',
    width: 0,
    height: 0,
    screenshot: '',
    hasGoogle: false,
    formVisible: false,
    googleSignedIn: false,
    hasGaps: false,
    onGoogleAuth: false,
    ready,
  };
  if (!page) return state;
  try {
    const vp = page.viewportSize() || { width: 1280, height: 800 };
    state.width = vp.width;
    state.height = vp.height;
    const buf = await page.screenshot({ type: 'png' });
    state.screenshot = buf.toString('base64');
  } catch {}
  try {
    state.hasGoogle = await page.evaluate(() => {
      if (document.querySelector('a[href*="google" i], a[href*="get_google" i], a[href*="accounts.google" i], [id*="google" i], [class*="google" i]')) return true;
      const els = Array.from(document.querySelectorAll('a, button, [role="button"]'));
      return els.some((e) => {
        if (/continue with google|sign ?in with google|log ?in with google|sign ?up with google|login with google|google login|google sign|google account/i.test((e.textContent || '').toLowerCase())) return true;
        if (e.tagName === 'IMG' && (e.src || '').toLowerCase().includes('google')) return true;
        return false;
      });
    }).catch(() => false);
    state.formVisible = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input, textarea, select')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && e.type !== 'hidden';
      }).length > 0;
    }).catch(() => false);
    state.onGoogleAuth = /accounts\.google\.com/.test(page.url());
    // Accounts currently known to Google in this profile (account chooser rows).
    // Lets the app render "tap to sign in as…" chips — no password needed when
    // the session is still valid, mirroring the IMAP/Gmail account picker.
    state.accounts = await page.evaluate(() => {
      const seen = new Set();
      const out = [];
      for (const e of document.querySelectorAll('[data-identifier]')) {
        const v = (e.getAttribute('data-identifier') || '').trim();
        if (/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) && !seen.has(v.toLowerCase())) {
          seen.add(v.toLowerCase());
          out.push(v);
        }
      }
      return out;
    }).catch(() => []);
  } catch {}
  try {
    const cookies = await context.cookies().catch(() => []);
    state.googleSignedIn = cookies.some((c) =>
      /\.?google\.com/.test(c.domain) && ['SID', 'HSID', 'SAPISID', '__Secure-1PSID'].includes(c.name)
    );
    state.hasGaps = cookies.some((c) =>
      /\.?google\.com/.test(c.domain) && c.name === '__Host-GAPS'
    );
  } catch {}
  return state;
}

async function attachPopupHandling() {
  // Whenever a popup (e.g. Google account chooser) opens, drive it.
  context.on('page', (p) => {
    if (!p || p === page) return;
    page = p;
    p.on('close', () => {
      page = context.pages().filter((x) => !x.isClosed()).pop() || page;
    });
  });
}

async function tryGoogleButton() {
  if (!page) return false;
  try {
    const url = page.url();
    // Already on Google's own sign-in page — there is no "Login with Google"
    // button to click, and blindly clicking an element whose id/class/href
    // merely mentions "google" can follow a help link off the page.
    if (/accounts\.google\.com/.test(url)) return false;
    const clicked = await page.evaluate(() => {
      // Only real OAuth entry points: a get_google redirect, the Google
      // accounts/consent URL, or a data-attribute that names the provider.
      const strongAttr = Array.from(document.querySelectorAll(
        'a[href*="get_google" i], a[href*="accounts.google" i], a[href*="google.com/o/oauth2" i], [data-provider*="google" i], [data-oauth*="google" i], [data-google*="true" i]'
      )).filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      let target = strongAttr[0];
      if (!target) {
        // Fall back to visible text that names the Google login action.
        target = Array.from(document.querySelectorAll('a, button, [role="button"]')).find((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && /continue with google|sign ?in with google|log ?in with google|sign ?up with google|login with google|google login|google sign|google account/i.test((e.textContent || '').toLowerCase());
        });
      }
      if (!target) return false;
      try { target.scrollIntoViewIfNeeded(); } catch {}
      target.click();
      return true;
    }).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(3500);
      const url = page.url();
      if (/accounts\.google|google\.com\/o\/oauth2/.test(url)) return true;
    }
    return clicked;
  } catch {
    return false;
  }
}

async function main() {
  try {
    const pw = await import('playwright-core');
    chromium = pw.chromium;
  } catch (e) {
    console.error('playwright not available');
    process.exit(1);
  }

  const launchArgs = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process', '--disable-site-isolation-trials',
    '--disable-web-security', '--disable-features=BlockInsecurePrivateNetworkRequests',
    '--disable-features=ChromeWhatsNewUI', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--disable-gpu', '--disable-gpu-compositing',
  ];
  try {
    const exePath = chromium.executablePath();
    if (exePath) launchArgs.push(`--icu-data-dir=${dirname(exePath)}`);
  } catch {}

  const profileDir = join(userDir, '.pwprofile');
  try { mkdirSync(profileDir, { recursive: true }); } catch {}

  context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: launchArgs,
    userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    geolocation: { latitude: 19.0760, longitude: 72.8777 },
    permissions: ['geolocation'],
  });
  browser = context.browser();
  attachPopupHandling();
  page = context.pages()[0] || await context.newPage();

  if (startUrl) {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await tryGoogleButton();
    await autoDrive();
  }
  ready = true;

  // Auto-drive Google's sign-in so the user only types the password.
  const autoDriveTimer = setInterval(() => { autoDrive().catch(() => {}); }, 1200);

  // Idle timeout: close the session after 10 minutes without interaction.
  let lastActivity = Date.now();
  const idleTimer = setInterval(() => {
    if (closing) return;
    if (Date.now() - lastActivity > 10 * 60 * 1000) {
      console.error('login-session: idle timeout');
      finishAndExit(false).catch(() => process.exit(0));
    }
  }, 30000);

  const respond = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };
  const readBody = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });

  async function finishAndExit(success) {
    if (closing) return;
    closing = true;
    let googleSession = false;
    let hasGaps = false;
    let cookieCount = 0;
    try {
      if (context) {
        const cookies = await context.cookies().catch(() => []);
        cookieCount = cookies.length;
        googleSession = cookies.some((c) =>
          /\.?google\.com/.test(c.domain) && ['SID', 'HSID', 'SAPISID', '__Secure-1PSID'].includes(c.name)
        );
        hasGaps = cookies.some((c) =>
          /\.?google\.com/.test(c.domain) && c.name === '__Host-GAPS'
        );
      }
    } catch {}
    const result = { success, googleSession, hasGaps, cookieCount };
    try {
      if (browser) await browser.close();
    } catch {}
    clearInterval(idleTimer);
    if (typeof autoDriveTimer !== 'undefined') clearInterval(autoDriveTimer);
    console.log('RESULT:' + JSON.stringify(result));
    process.exit(0);
  }

  const server = http.createServer(async (req, res) => {
    lastActivity = Date.now();
    const parts = req.url.split('?')[0];
    try {
      if (req.method === 'GET' && parts === '/state') {
        return respond(res, 200, await snapshot());
      }
      const body = await readBody(req);
      if (req.method === 'POST' && parts === '/tap') {
        if (page && body.x != null && body.y != null) {
          await page.mouse.click(body.x, body.y);
          await page.waitForTimeout(400);
        }
        return respond(res, 200, await snapshot());
      }
      if (req.method === 'POST' && parts === '/type') {
        if (page && body.text != null) {
          await page.keyboard.type(String(body.text), { delay: 30 });
        }
        return respond(res, 200, await snapshot());
      }
      if (req.method === 'POST' && parts === '/account') {
        if (page && body.email) {
          const clicked = await page.evaluate((email) => {
            const el = Array.from(document.querySelectorAll('[data-identifier]')).find((e) =>
              (e.getAttribute('data-identifier') || '').toLowerCase() === String(email).toLowerCase()
            );
            if (!el) return false;
            try { el.scrollIntoViewIfNeeded(); } catch {}
            el.click();
            return true;
          }, String(body.email)).catch(() => false);
          await page.waitForTimeout(1500);
        }
        return respond(res, 200, await snapshot());
      }
      if (req.method === 'POST' && parts === '/navigate') {
        if (page && body.url) {
          await page.goto(String(body.url), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          await page.waitForTimeout(1500);
          await tryGoogleButton();
        }
        return respond(res, 200, await snapshot());
      }
      if (req.method === 'POST' && parts === '/back') {
        if (page) { await page.goBack({ timeout: 30000 }).catch(() => {}); await page.waitForTimeout(800); }
        return respond(res, 200, await snapshot());
      }
      if (req.method === 'POST' && parts === '/finish') {
        if (closing) return respond(res, 200, { success: true });
        closing = true;
        let googleSession = false;
        let hasGaps = false;
        let cookieCount = 0;
        try {
          if (context) {
            const cookies = await context.cookies().catch(() => []);
            cookieCount = cookies.length;
            googleSession = cookies.some((c) =>
              /\.?google\.com/.test(c.domain) && ['SID', 'HSID', 'SAPISID', '__Secure-1PSID'].includes(c.name)
            );
            hasGaps = cookies.some((c) =>
              /\.?google\.com/.test(c.domain) && c.name === '__Host-GAPS'
            );
          }
        } catch {}
        const result = { success: true, googleSession, hasGaps, cookieCount };
        respond(res, 200, result);
        clearInterval(idleTimer);
        setTimeout(() => { try { if (browser) browser.close(); } catch {} process.exit(0); }, 500);
        return;
      }
      return respond(res, 404, { error: 'not found' });
    } catch (e) {
      return respond(res, 500, { error: e.message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`LOGIN_SESSION_PORT:${port}`);
  });
}

main().catch((e) => {
  console.error('login-session fatal:', e.message);
  process.exit(1);
});
