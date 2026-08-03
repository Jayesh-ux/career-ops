#!/usr/bin/env node
/**
 * smoke-pw.mjs — Playwright backend health check.
 * Launches Chromium exactly like apply-job.mjs (persistent profile), loads a
 * baseline page + a real portal job page, and reports what works.
 *
 * Usage:
 *   node smoke-pw.mjs --user-dir <dir>
 */

import { readdirSync, mkdirSync, cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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
    } catch {}
  }
  cleanReady = hasBrowser(CLEAN_BROWSERS_DIR);
}
if (cleanReady) process.env.PLAYWRIGHT_BROWSERS_PATH = CLEAN_BROWSERS_DIR;
else if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const src = l2sCandidates.find(hasBrowser);
  if (src) process.env.PLAYWRIGHT_BROWSERS_PATH = src;
}

const args = process.argv.slice(2);
let userDir = process.env.CAREER_OPS || __dirname;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const launchArgs = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process', '--disable-site-isolation-trials',
  '--disable-web-security', '--disable-features=BlockInsecurePrivateNetworkRequests',
  '--disable-features=ChromeWhatsNewUI', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--disable-gpu', '--disable-gpu-compositing',
];

const out = {
  playwright_import: false,
  browser_launch: false,
  baseline: null,
  portal: null,
  cookies: null,
  error: null,
};

try {
  const pw = await import('playwright-core');
  out.playwright_import = true;
  const chromium = pw.chromium;

  try {
    const exePath = chromium.executablePath();
    if (exePath) launchArgs.push(`--icu-data-dir=${dirname(exePath)}`);
  } catch {}

  const profileDir = join(userDir, '.pwprofile');
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      args: launchArgs,
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata',
      geolocation: { latitude: 19.0760, longitude: 72.8777 },
      permissions: ['geolocation'],
    });
  } catch (e) {
    out.error = `launchPersistentContext failed: ${e.message}`;
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
  out.browser_launch = true;
  const browser = context.browser();
  const page = await context.newPage();

  // Baseline: plain page load.
  try {
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    out.baseline = {
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  } catch (e) {
    out.baseline = { ok: false, error: e.message };
  }

  // Portal: real Internshala job page.
  const portalUrl = 'https://internshala.com/internship/detail/software-development-intern--full-stack-data-engineering-applied-ai-internship-in-multiple-locations-at-prop-pie-fractional-ownership-for-real-estate1785494457';
  try {
    await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const portal = await page.evaluate(() => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const hasText = (sel, re) => Array.from(document.querySelectorAll(sel)).some((e) => re.test((e.textContent || '').toLowerCase()));
      return {
        url: location.href.slice(0, 160),
        title: document.title.slice(0, 120),
        applyButton: hasText('button, a, [role="button"]', /apply|start now|login to apply/i),
        googleButton: !!Array.from(document.querySelectorAll('a,button,[role="button"]')).find((e) => /continue with google|sign ?in with google|log ?in with google|login with google|google login/i.test((e.textContent || '').toLowerCase())),
        visibleInputs: Array.from(document.querySelectorAll('input, textarea, select')).filter((e) => vis(e) && e.type !== 'hidden').length,
        visiblePassword: !!Array.from(document.querySelectorAll('input[type="password"]')).find((e) => vis(e)),
      };
    });
    out.portal = { ok: true, ...portal };
  } catch (e) {
    out.portal = { ok: false, error: e.message };
  }

  // Cookies: google auth session?
  try {
    const cookies = await context.cookies().catch(() => []);
    out.cookies = {
      count: cookies.length,
      googleSignedIn: cookies.some((c) => /\.?google\.com/.test(c.domain) && ['SID', 'HSID', 'SAPISID', '__Secure-1PSID'].includes(c.name)),
      googleNames: cookies.filter((c) => /\.?google\.com/.test(c.domain)).map((c) => c.name).sort(),
      internshalaNames: cookies.filter((c) => /internshala/.test(c.domain)).map((c) => c.name).sort(),
    };
  } catch (e) {
    out.cookies = { error: e.message };
  }

  try { if (browser) await browser.close(); } catch {}

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
} catch (e) {
  out.error = e.message;
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}
