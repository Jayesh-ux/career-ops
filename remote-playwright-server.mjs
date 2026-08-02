#!/usr/bin/env node
/**
 * remote-playwright-server.mjs — HTTP API that shells out to apply-job.mjs
 *
 * Keeps all Playwright logic in apply-job.mjs (the single tested entry point).
 * This server just wraps it as an HTTP endpoint so the bridge server on a
 * phone (where Playwright can't run) can delegate Playwright work here.
 *
 * Endpoints:
 *   POST /playwright/extract  — run apply-job.mjs in extract mode
 *   POST /playwright/fill     — run apply-job.mjs in fill mode
 *   POST /playwright/scrape   — extract all links/titles from a page (no keyword logic)
 *   GET  /playwright/health   — health check
 */

import express from 'express';
import cors from 'cors';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '9998', 10);
const APPLY_JOB = join(__dirname, 'apply-job.mjs');
const require = createRequire(import.meta.url);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function runApplyJob(args) {
  const result = spawnSync('node', [APPLY_JOB, ...args], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60000,
  });
  if (result.error) {
    return { error: result.error.message, stderr: result.stderr?.slice(0, 500) };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: 'invalid JSON output', stdout: result.stdout?.slice(0, 1000), stderr: result.stderr?.slice(0, 500) };
  }
}

// ── Extract mode: load a job URL, extract form fields, generate answers ──
app.post('/playwright/extract', (req, res) => {
  const { url, headless, userDir, stealth } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  const args = [url, '--headless'];
  if (stealth) args.push('--stealth');
  if (userDir) args.push('--user-dir', userDir);
  if (headless === false) args.splice(args.indexOf('--headless'), 1);

  console.log(`[remote-pw] extract ${url}`);
  const output = runApplyJob(args);
  res.json(output);
});

// ── Fill mode: fill an application form with pre-generated answers ──
app.post('/playwright/fill', (req, res) => {
  const { url, answersJson, company, headless, userDir, stealth } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  if (!answersJson) return res.status(400).json({ error: 'answersJson required' });

  const args = [url, '--fill', '--answers-json', answersJson, '--headless'];
  if (stealth) args.push('--stealth');
  if (company) args.push('--company', company);
  if (userDir) args.push('--user-dir', userDir);

  console.log(`[remote-pw] fill ${url}`);
  const output = runApplyJob(args);
  res.json(output);
});

// ── Guided apply: generate manual apply guide with field mapping ──
app.post('/playwright/guided-apply', (req, res) => {
  const { url, headless, userDir } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  const args = [url, '--manual-guide'];
  if (userDir) args.push('--user-dir', userDir);

  console.log(`[remote-pw] guided-apply ${url}`);
  const output = runApplyJob(args);
  res.json(output);
});

// ── Scrape: extract all links from a careers page (no keyword logic) ──
app.post('/playwright/scrape', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  console.log(`[remote-pw] scrape ${url}`);

  let chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    try {
      const pw = await import('playwright-core');
      chromium = pw.chromium;
    } catch (e) {
      return res.status(503).json({ error: 'playwright not available' });
    }
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (e) {
    return res.status(503).json({ error: 'browser launch failed' });
  }

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .filter(a => a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#'))
        .map(a => ({
          title: (a.textContent || '').trim().slice(0, 200),
          url: a.href
        }))
        .filter(l => l.title.length > 0);
    });

    const title = await page.title();
    await page.close();

    console.log(`[remote-pw] scrape ${url}: ${links.length} links`);
    res.json({ success: true, url, title, links });
  } catch (e) {
    res.json({ success: false, url, error: e.message?.slice(0, 200) });
  } finally {
    await browser.close();
  }
});

app.get('/playwright/health', (req, res) => {
  const hasPlaywright = (() => {
    try { return !!require('playwright'); } catch {
      try { return !!require('playwright-core'); } catch { return false; }
    }
  })();
  res.json({
    status: 'ok',
    server: 'remote-playwright',
    applyJobExists: existsSync(APPLY_JOB),
    playWrightAvailable: hasPlaywright,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Remote Playwright server on http://0.0.0.0:${PORT}`);
  console.log(`POST /playwright/extract       -- extract form fields (via apply-job.mjs)`);
  console.log(`POST /playwright/fill          -- fill application form (via apply-job.mjs)`);
  console.log(`POST /playwright/guided-apply  -- manual apply guide with field mapping (no browser)`);
  console.log(`POST /playwright/scrape        -- scrape page links (inline Playwright)`);
  console.log(`GET  /playwright/health        -- health check`);
});
