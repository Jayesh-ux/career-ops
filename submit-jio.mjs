#!/usr/bin/env node
/**
 * submit-jio.mjs — Apply to Jio Graduate Engineer Trainee (SDE)
 *
 * Opens Jio's Student & Campus page where the GET program is listed.
 * Since Jio requires account creation, this guides through the process.
 *
 * Usage:
 *   node submit-jio.mjs              # headless (check page)
 *   node submit-jio.mjs --show       # visible browser (to register & apply)
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const headless = !process.argv.includes('--show');

async function main() {
  const browser = await chromium.launch({ headless, channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Step 1: Go to Jio Student Campus page
  console.log('🚀 Opening Jio Careers - Students & Campuses...');
  await page.goto('https://careers.jio.com/frmStudent_Campus.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log(`📄 Title: ${await page.title()}`);

  // Take a screenshot
  await page.screenshot({ path: resolve(__dirname, 'output/jio-campus-page.png'), fullPage: true });
  console.log('📸 Screenshot saved to output/jio-campus-page.png');

  // Print what we can see
  const bodyText = await page.locator('body').innerText();
  const getSection = bodyText.split('WORK WITH US')[1]?.split('ENGAGE WITH US')[0] || 'Not found';
  console.log(`\n📋 Work With Us section:\n${getSection.trim()}`);

  if (!headless) {
    console.log('\n👀 Browser is open. Please:');
    console.log('   1. Click "Graduate Engineer Trainee Program"');
    console.log('   2. Register / Login to your account');
    console.log('   3. Fill in your details and upload CV');
    console.log('   4. Submit the application');
    console.log('\n📎 CV to use: output/cv-jayesh-generic.pdf');
    console.log('\nPress Ctrl+C when done.\n');
    await new Promise(() => {});
  } else {
    // Check if there are clickable elements for GET
    const getLinks = await page.locator('a, button, [role="button"]').filter({ hasText: /graduate engineer trainee|get/i }).count();
    console.log(`\n🔗 GET program links found: ${getLinks}`);
    
    // Try clicking on GET section
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const link of links) {
        if (link.innerText.toLowerCase().includes('graduate engineer trainee')) {
          link.click();
          return true;
        }
      }
      return false;
    });
    console.log(`🔗 Clicked GET link: ${clicked}`);
    
    if (clicked) {
      await page.waitForTimeout(3000);
      console.log(`📄 New URL: ${page.url()}`);
      await page.screenshot({ path: resolve(__dirname, 'output/jio-get-page.png'), fullPage: true });
    }
  }

  await browser.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
