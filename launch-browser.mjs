#!/usr/bin/env node
/**
 * launch-browser.mjs — Stealth Chromium launcher for career-ops
 *
 * Uses system Chromium (not Playwright's bundled one) with anti-detection
 * measures to bypass headless/automation blockers on job portals.
 *
 * Two modes:
 *   headless=false → visible browser window on the phone screen (for OTP flows)
 *   headless=true  → stealth headless for automated form filling
 *
 * Usage:
 *   node launch-browser.mjs <url> [--headless] [--timeout=60]
 */

import { chromium } from 'playwright';
import { existsSync } from 'fs';

const SYSTEM_CHROMIUM = '/usr/bin/chromium';

function log(msg) {
  process.stderr.write(`[browser] ${msg}\n`);
}

async function launch(url = 'about:blank', opts = {}) {
  const headless = opts.headless ?? false;
  const timeout = (opts.timeout ?? 60) * 1000;

  const executablePath = existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined;
  if (executablePath) log(`Using system Chromium: ${SYSTEM_CHROMIUM}`);
  else log('Using Playwright bundled Chromium');

  const launchArgs = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--disable-accelerated-2d-canvas',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-notifications',
    '--disable-popup-blocking',
  ];

  // On Android termux, DISPLAY may not be set for headful mode.
  // Try Xvfb fallback if available.
  if (!headless && !process.env.DISPLAY) {
    const { execSync } = await import('child_process');
    try {
      execSync('which Xvfb', { stdio: 'ignore' });
      log('No DISPLAY set — starting Xvfb on :99');
      execSync('Xvfb :99 -screen 0 1280x720x24 &', { stdio: 'ignore' });
      process.env.DISPLAY = ':99';
    } catch {
      log('WARNING: No DISPLAY and Xvfb not available. Headful mode may fail.');
    }
  }

  const browser = await chromium.launch({
    executablePath,
    headless,
    args: launchArgs,
  });

  const ctx = await browser.newContext({
    // Mobile Android UA to match the phone's actual platform
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    geolocation: { latitude: 19.0760, longitude: 72.8777 },
    permissions: ['geolocation'],
    // Block unnecessary resources for speed
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
    },
  });

  const page = await ctx.newPage();

  // Anti-detection: mask webdriver, add plugins, fix chrome runtime
  await page.addInitScript(() => {
    delete navigator.__proto__.webdriver;
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Fake real plugins array
    const origPlugins = navigator.plugins;
    if (origPlugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
    }

    // Fix chrome.runtime (headless returns undefined)
    if (!window.chrome) {
      window.chrome = { runtime: {} };
    }

    // Override permissions query to avoid automation detection
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (...args) =>
        args[0]?.name === 'notifications'
          ? Promise.resolve({ state: 'denied' })
          : origQuery.apply(navigator.permissions, args);
    }
  });

  log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

  if (!headless) {
    log('Browser is visible. Complete any OTP/interaction, then press Ctrl+C when done.');
  }

  return { browser, context: ctx, page };
}

// CLI entrypoint
const args = process.argv.slice(2);
const url = args.find(a => a.startsWith('http')) || 'about:blank';
const headless = args.includes('--headless');
const timeoutArg = args.find(a => a.startsWith('--timeout='));
const timeout = timeoutArg ? parseInt(timeoutArg.split('=')[1]) : 60;

launch(url, { headless, timeout })
  .then(({ browser, page }) => {
    // Keep alive for headful mode
    if (!headless) {
      process.on('SIGINT', async () => {
        await browser.close();
        process.exit(0);
      });
    } else {
      // Auto-close after timeout for headless
      setTimeout(() => browser.close(), timeout * 1000);
    }
  })
  .catch(err => {
    console.error('Launch failed:', err.message);
    process.exit(1);
  });

export { launch };
