#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CV_PATH = resolve(__dirname, 'output/cv-elevenlabs.pdf');

const CANDIDATE = {
  name: 'Rohit Shankarram Jaiswar',
  email: 'rohit.s.jaiswar@gmail.com',
  phone: '8286996458',
  linkedin: 'https://linkedin.com/in/rohitjaiswar',
  github: 'https://github.com/rohitjaiswar',
  portfolio: 'https://portfolio-next-js-chi-beryl.vercel.app/',
};

const JOBS = {
  fde: {
    title: 'Forward Deployed Engineer - Software Engineer',
    url: 'https://jobs.ashbyhq.com/elevenlabs/6c4c57c1-ec72-42ba-af3a-eb7aebbde2e6',
  },
  solutions: {
    title: 'Solutions Engineer',
    url: 'https://jobs.ashbyhq.com/elevenlabs/fb1fd9cc-bd6d-4895-be29-4bc37d0c31a0',
  }
};

async function applyToRole(key) {
  const job = JOBS[key];
  if (!job) {
    console.error(`Invalid job key: ${key}`);
    return;
  }

  console.log(`\n🚀 Starting visible auto-fill for: ${job.title}`);
  console.log(`🔗 URL: ${job.url}`);

  if (!existsSync(CV_PATH)) {
    console.error(`❌ CV PDF not found at: ${CV_PATH}. Run 'node generate-pdf.mjs templates/cv-template.html output/cv-elevenlabs.pdf' first.`);
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  try {
    console.log('1. Navigating to Ashby page...');
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll down to the form
    console.log('2. Scrolling to application form...');
    const formElement = page.locator('form').first();
    await formElement.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(2000);

    // Fill Full Name
    console.log('3. Filling Name...');
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i], label:has-text("Full Name") + input, input#name').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill(CANDIDATE.name);
      await page.waitForTimeout(2000);
    }

    // Fill Email
    console.log('4. Filling Email...');
    const emailInput = page.locator('input[type="email"], input[name="email"], label:has-text("Email") + input, input#email').first();
    if (await emailInput.isVisible()) {
      await emailInput.fill(CANDIDATE.email);
      await page.waitForTimeout(2000);
    }

    // Fill Phone
    console.log('5. Filling Phone...');
    const phoneInput = page.locator('input[type="tel"], input[name="phone"], label:has-text("Phone") + input, input#phone').first();
    if (await phoneInput.isVisible()) {
      await phoneInput.fill(CANDIDATE.phone);
      await page.waitForTimeout(2000);
    }

    // Upload CV
    console.log('6. Uploading CV PDF...');
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(CV_PATH);
      await page.waitForTimeout(3000);
    }

    // Fill LinkedIn
    console.log('7. Filling LinkedIn...');
    const linkedinInput = page.locator('input[placeholder*="linkedin" i], label:has-text("LinkedIn") + input, input[name*="linkedin" i]').first();
    if (await linkedinInput.isVisible()) {
      await linkedinInput.fill(CANDIDATE.linkedin);
      await page.waitForTimeout(2000);
    }

    // Fill GitHub
    console.log('8. Filling GitHub...');
    const githubInput = page.locator('input[placeholder*="github" i], label:has-text("GitHub") + input, input[name*="github" i]').first();
    if (await githubInput.isVisible()) {
      await githubInput.fill(CANDIDATE.github);
      await page.waitForTimeout(2000);
    }

    // Fill Portfolio
    console.log('9. Filling Portfolio/Website...');
    const portfolioInput = page.locator('input[placeholder*="portfolio" i], input[placeholder*="website" i], label:has-text("Portfolio") + input, label:has-text("Website") + input, input[name*="portfolio" i]').first();
    if (await portfolioInput.isVisible()) {
      await portfolioInput.fill(CANDIDATE.portfolio);
      await page.waitForTimeout(2000);
    }

    console.log('\n👀 ================= MANUAL REVIEW REQUIRED =================');
    console.log('   Form has been auto-filled. Please check the browser window.');
    console.log('   If there are additional custom questions, answer them.');
    console.log('   Once satisfied, click Submit/Apply on the webpage.');
    console.log('   Press CTRL+C in this terminal when you are done to close.');
    console.log('   ===========================================================');

    // Keep browser open indefinitely for manual review and submit
    await new Promise(() => {});

  } catch (e) {
    console.error(`❌ Playwright error: ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const role = process.argv[2];
  if (role === 'fde') {
    await applyToRole('fde');
  } else if (role === 'solutions') {
    await applyToRole('solutions');
  } else {
    console.log(`
Usage:
  node submit-elevenlabs.mjs fde        # Open FDE role application page
  node submit-elevenlabs.mjs solutions  # Open Solutions Engineer role application page
`);
  }
}

main();
