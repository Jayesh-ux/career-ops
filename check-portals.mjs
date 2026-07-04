#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function tryUrls() {
  const browser = await chromium.launch({ headless: true });
  const urls = [
    ['RELX (RiskSolutions)', 'https://relx.wd3.myworkdayjobs.com/en-US/RiskSolutions/job/Mumbai/Software-Engineer-I_R109592-1?q=2026'],
    ['Wohlig (Keka)', 'https://wohlig.keka.com/careers/jobdetails/45453'],
  ];

  for (const [name, url] of urls) {
    console.log(`\n=== ${name} ===`);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      const title = await page.title();
      const text = await page.locator('body').innerText();
      console.log(`Title: "${title}"`);
      console.log(`Text length: ${text.length} chars`);
      console.log(`First 500 chars: ${text.slice(0, 500)}`);

      // Check for apply buttons
      const applyBtn = page.locator('button, a, [role="button"], input[type="submit"]').filter({ hasText: /apply|submit|register/i });
      const count = await applyBtn.count();
      console.log(`Apply buttons found: ${count}`);

      if (count > 0) {
        const btnText = await applyBtn.first().textContent();
        console.log(`First apply button text: "${btnText}"`);
      }

      await page.screenshot({ path: `output/${name.toLowerCase().replace(/\s+/g, '-')}.png`, fullPage: true });
      console.log(`Screenshot saved`);
      await page.close();
    } catch (err) {
      console.log(`Error: ${err.message}`);
    }
  }

  await browser.close();
}

tryUrls();
