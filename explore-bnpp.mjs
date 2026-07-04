#!/usr/bin/env node
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  try {
    // Go to jobs page
    await page.goto('https://www.apac.bnppispl.com/dist/career/job-offer.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // List all visible links and buttons
    const visibleLinks = await page.locator('a:visible, button:visible').all();
    console.log(`Visible links/buttons: ${visibleLinks.length}`);
    for (const el of visibleLinks) {
      const txt = (await el.textContent() || '').trim();
      const href = await el.getAttribute('href') || '';
      if (txt || href) console.log(`  "${txt.slice(0, 50)}" -> ${href.slice(0, 60)}`);
    }

    // Try the top nav items - especially CAREERS
    const careersNav = page.locator('nav a, .nav a, [class*="nav"] a, header a').filter({ hasText: /careers|career/i });
    const careersNavCount = await careersNav.count();
    console.log(`\nCareers nav items: ${careersNavCount}`);
    
    // Get the full page HTML for analysis (first 5000 chars)
    const html = await page.content();
    console.log(`\nPage HTML snippet:`);
    console.log(html.slice(0, 5000));

    // Check if there are any iframes
    const iframes = await page.locator('iframe').count();
    console.log(`\nIframes: ${iframes}`);

    await page.screenshot({ path: 'output/bnpp-structure.png', fullPage: true });
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}
main();
