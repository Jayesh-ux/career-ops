#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CV_PATH = resolve(__dirname, 'output/cv-jayesh-relx.pdf');
const JOB_URL = 'https://relx.wd3.myworkdayjobs.com/en-US/RiskSolutions/job/Mumbai/Software-Engineer-I_R109592-1?q=2026';

async function submit() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log('Navigating to RELX Workday...');
    await page.goto(JOB_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for page to render
    await page.waitForTimeout(3000);

    // Check if we can see the apply button or job content
    const content = await page.content();
    const hasApply = content.includes('Apply') || content.includes('apply');
    const hasJob = content.includes('Software Engineer') || content.includes('R109592');

    console.log('Page loaded. Has Apply button:', hasApply);
    console.log('Page title:', await page.title());

    // Take a screenshot to see what's there
    await page.screenshot({ path: 'output/relx-page.png', fullPage: true });
    console.log('Screenshot saved to output/relx-page.png');

    // Try to find and click apply button
    const applyButtons = await page.locator('button, a, [role="button"]').filter({ hasText: /apply/i }).all();
    console.log(`Found ${applyButtons.length} potential apply buttons`);

    if (applyButtons.length > 0) {
      await applyButtons[0].click();
      console.log('Clicked Apply');
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'output/relx-after-apply.png', fullPage: true });
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

submit();
