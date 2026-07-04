#!/usr/bin/env node
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  try {
    await page.goto('https://www.apac.bnppispl.com/dist/career/job-offer.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Click "Our Job Offers" link
    const jobLinks = await page.locator('a').filter({ hasText: /job offer|our job offers/i }).all();
    console.log(`Found ${jobLinks.length} job offer links`);
    
    for (const link of jobLinks) {
      const href = await link.getAttribute('href');
      const text = await link.textContent();
      console.log(`  "${text?.trim()}" -> ${href}`);
    }

    // Click the first "Our Job Offers" link
    if (jobLinks.length > 0) {
      await jobLinks[0].click();
      await page.waitForTimeout(5000);
      console.log(`\nAfter click - URL: ${page.url()}`);
      const body = await page.locator('body').innerText().catch(() => '');
      console.log(`Body: ${body.slice(0, 2000)}`);
      await page.screenshot({ path: 'output/bnpp-joblist.png', fullPage: true });
    }

    // Also check Campus Hire
    await page.goto('https://www.apac.bnppispl.com/dist/career/career.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const campusLinks = await page.locator('a').filter({ hasText: /campus/i }).all();
    console.log(`\nCampus links: ${campusLinks.length}`);
    for (const link of campusLinks) {
      const href = await link.getAttribute('href');
      const text = await link.textContent();
      console.log(`  "${text?.trim()}" -> ${href}`);
    }

    // Try clicking Campus Hire
    if (campusLinks.length > 0) {
      await campusLinks[0].click();
      await page.waitForTimeout(5000);
      console.log(`\nAfter campus click - URL: ${page.url()}`);
      const body = await page.locator('body').innerText().catch(() => '');
      console.log(`Body: ${body.slice(0, 2000)}`);
      await page.screenshot({ path: 'output/bnpp-campus.png', fullPage: true });
    }

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}
main();
