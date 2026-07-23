#!/usr/bin/env node

/**
 * check-liveness.mjs — Playwright job link liveness checker
 *
 * Tests whether job posting URLs are still active or have expired.
 * Uses the same detection logic as scan.md step 7.5.
 * Zero Claude API tokens. Two rungs: a free ATS API check first
 * (Greenhouse/Lever — no browser), then Playwright for everything else.
 *
 * Usage:
 *   node check-liveness.mjs <url1> [url2] ...
 *   node check-liveness.mjs --file urls.txt
 *   node check-liveness.mjs --json <url1> [url2] ...
 *
 * Exit code: 0 if all active, 1 if any expired or uncertain
 */

import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import {
  checkUrlLivenessWithFallback,
  createHeadedPageProvider,
  newLivenessPage,
  jitteredDelayMs,
  sleep,
} from './liveness-browser.mjs';
import { checkLivenessViaApi } from './liveness-api.mjs';

async function main() {
  const args = process.argv.slice(2);

  const jsonMode = args.includes('--json');
  const filteredArgs = args.filter(a => a !== '--json');

  const noFallback = filteredArgs.includes('--no-fallback');
  const throttleArg = filteredArgs.find((a) => a === '--throttle' || a.startsWith('--throttle='));
  const throttleBaseMs = throttleArg ? (Number(throttleArg.split('=')[1]) || 5000) : 0;
  const positional = filteredArgs.filter((a) => a !== '--no-fallback' && a !== throttleArg);

  if (positional.length === 0) {
    console.error('Usage: node check-liveness.mjs [--json] [--no-fallback] [--throttle[=ms]] <url1> [url2] ...');
    console.error('       node check-liveness.mjs [--json] [--no-fallback] [--throttle[=ms]] --file urls.txt');
    process.exit(1);
  }

  let urls;
  if (positional[0] === '--file') {
    const text = await readFile(positional[1], 'utf-8');
    urls = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } else {
    urls = positional;
  }

  if (!jsonMode) {
    const notes = [
      noFallback ? null : 'headed fallback on challenge',
      throttleBaseMs ? `throttle ~${throttleBaseMs / 1000}-${(throttleBaseMs * 2) / 1000}s` : null,
    ].filter(Boolean);
    console.log(`Checking ${urls.length} URL(s)...${notes.length ? ` (${notes.join(', ')})` : ''}\n`);
  }

  let browser = null, page = null, headed = null;
  async function ensureBrowser() {
    if (browser) return;
    browser = await chromium.launch({ headless: true });
    page = await newLivenessPage(browser);
    headed = noFallback ? null : createHeadedPageProvider(chromium);
  }

  let active = 0, expired = 0, uncertain = 0, viaApi = 0;
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let result, reason, usedBrowser = false;

    const api = await checkLivenessViaApi(url);
    if (api) {
      ({ result, reason } = api);
      viaApi++;
    } else {
      await ensureBrowser();
      const getHeadedPage = headed ? () => headed.get() : undefined;
      ({ result, reason } = await checkUrlLivenessWithFallback(page, url, { getHeadedPage }));
      usedBrowser = true;
    }

    if (jsonMode) {
      results.push({ url, status: result, reason: reason || '', viaApi: !!api });
    } else {
      const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[result];
      console.log(`${icon} ${result.padEnd(10)} ${api ? '(api) ' : '      '}${url}`);
      if (result !== 'active') console.log(`           ${reason}`);
    }
    
    if (result === 'active') active++;
    else if (result === 'expired') expired++;
    else uncertain++;

    const wait = usedBrowser && i < urls.length - 1 ? jitteredDelayMs(throttleBaseMs) : 0;
    if (wait) await sleep(wait);
  }

  if (headed) await headed.close();
  if (browser) await browser.close();

  if (jsonMode) {
    console.log(JSON.stringify({ results, active, expired, uncertain, viaApi }));
  } else {
    console.log(`\nResults: ${active} active  ${expired} expired  ${uncertain} uncertain  (${viaApi} via API, no browser)`);
  }
  
  if (expired > 0 || uncertain > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
