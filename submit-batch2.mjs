#!/usr/bin/env node
import { chromium } from 'playwright';

async function main() {
  // Decisions - Greenhouse portal
  console.log('=== Decisions Greenhouse ===');
  const b1 = await chromium.launch({ headless: true });
  const p1 = await b1.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p1.goto('https://decisions.com/jobs-listing/?gh_jid=4960061007', { waitUntil: 'networkidle', timeout: 30000 });
    await p1.waitForTimeout(3000);
    console.log(`Title: ${await p1.title()}`);
    console.log(`URL: ${p1.url()}`);
    const body = await p1.locator('body').innerText().catch(() => '');
    console.log(`Body (first 1000): ${body.slice(0, 1000)}`);
    const applyBtn = await p1.locator('button, a, [role="button"]').filter({ hasText: /apply|submit/i }).count();
    console.log(`Apply buttons: ${applyBtn}`);
    await p1.screenshot({ path: 'output/decisions-page.png', fullPage: true });
  } catch (e) { console.error(`Decisions error: ${e.message}`); }
  await b1.close();

  // Teleperformance - Workday
  console.log('\n=== Teleperformance Workday ===');
  const b2 = await chromium.launch({ headless: true });
  const p2 = await b2.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p2.goto('https://onetp.wd1.myworkdayjobs.com/Teleperformance/job/DIBS-Mumbai-Thane/Software-Development-Intern_REQ-2026-28101', { waitUntil: 'networkidle', timeout: 30000 });
    await p2.waitForTimeout(3000);
    console.log(`Title: ${await p2.title()}`);
    console.log(`URL: ${p2.url()}`);
    const body = await p2.locator('body').innerText().catch(() => '');
    console.log(`Body (first 1000): ${body.slice(0, 1000)}`);
    const applyBtn = await p2.locator('button, a, [role="button"]').filter({ hasText: /apply|submit|sign in/i }).count();
    console.log(`Apply buttons: ${applyBtn}`);
    await p2.screenshot({ path: 'output/teleperformance-page.png', fullPage: true });
  } catch (e) { console.error(`TP error: ${e.message}`); }
  await b2.close();

  // Ingram Micro India careers
  console.log('\n=== Ingram Micro India ===');
  const b3 = await chromium.launch({ headless: true });
  const p3 = await b3.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p3.goto('https://careers.ingrammicro.com/en/locations/apac/india/', { waitUntil: 'networkidle', timeout: 30000 });
    await p3.waitForTimeout(3000);
    console.log(`Title: ${await p3.title()}`);
    const body = await p3.locator('body').innerText().catch(() => '');
    console.log(`Body (first 800): ${body.slice(0, 800)}`);
    const links = await p3.locator('a').filter({ hasText: /graduate|trainee|engineer/i }).count();
    console.log(`Relevant links: ${links}`);
    await p3.screenshot({ path: 'output/ingram-india.png', fullPage: true });
  } catch (e) { console.error(`Ingram error: ${e.message}`); }
  await b3.close();
}
main();
