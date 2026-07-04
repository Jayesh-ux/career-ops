#!/usr/bin/env node
import { chromium } from 'playwright';

async function checkPortal(url, label, opts = {}) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  try {
    console.log(`\n=== ${label} ===`);
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const title = await page.title();
    const body = await page.locator('body').innerText().catch(() => '');
    console.log(`Status: ${resp?.status()}, Title: ${title}`);
    console.log(`Body (first 800): ${body.slice(0, 800)}`);
    const applyBtn = await page.locator('button, a, [role="button"]').filter({ hasText: /apply|submit|sign in|create account|candidat/i }).count();
    console.log(`Apply/Register buttons: ${applyBtn}`);
    await page.screenshot({ path: `output/${label.replace(/[^a-z0-9]/g, '-').slice(0, 20)}.png`, fullPage: true });
    return { success: resp?.ok(), body, title, page, browser };
  } catch (e) {
    console.error(`Error: ${e.message}`);
    await browser.close();
    return { success: false, error: e.message, page: null, browser: null };
  }
}

async function main() {
  // Siemens - Thane
  const siemens = await checkPortal('https://jobs.siemens.com/en_US/externaljobs/JobDetail/495981', 'Siemens Thane');
  if (siemens.page) await siemens.page.close();

  // Ingram Micro - Mumbai
  const ingram = await checkPortal('https://careers.ingrammicro.com/en/jobs/r-115589/graduate-engineer-trainee/', 'Ingram Micro');
  if (ingram.page) await ingram.page.close();

  // Siemens auth
  await new Promise(r => setTimeout(r, 1000));
  try {
    const b2 = await chromium.launch({ headless: true });
    const p2 = await b2.newPage({ viewport: { width: 1280, height: 900 } });
    const r2 = await p2.goto('https://jobs.siemens.com/en_US/externaljobs/login', { waitUntil: 'networkidle', timeout: 30000 });
    await p2.waitForTimeout(3000);
    console.log(`\n=== Siemens Login ===`);
    console.log(`Status: ${r2?.status()}, Title: ${await p2.title()}`);
    const body2 = await p2.locator('body').innerText().catch(() => '');
    console.log(`Body (first 500): ${body2.slice(0, 500)}`);
    const registerBtn = await p2.locator('button, a, [role="button"]').filter({ hasText: /register|create account|sign up|new user/i }).count();
    console.log(`Register buttons: ${registerBtn}`);
    await p2.screenshot({ path: 'output/siemens-login.png', fullPage: true });
    await b2.close();
  } catch (e) {
    console.error(`Siemens Login error: ${e.message}`);
  }
}
main();
