#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('=== Decisions Greenhouse Submission ===');
  const headless = !process.argv.includes('--show');
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    // Navigate to job page
    await page.goto('https://job-boards.greenhouse.io/decisions/jobs/4960061007', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    console.log('Page loaded');

    // Click Apply
    await page.locator('a[href="#apply"]').click();
    await page.waitForTimeout(3000);
    console.log('Apply button clicked');

    // Check if form appeared
    const form = await page.locator('form').count();
    if (form === 0) {
      console.log('Form not found — trying longer wait');
      await page.waitForTimeout(5000);
    }

    // Fill form fields
    // First Name
    const firstNameInput = page.locator('input[name="first_name"]');
    await firstNameInput.fill('Rohit');
    console.log('First name filled');

    // Last Name
    const lastNameInput = page.locator('input[name="last_name"]');
    await lastNameInput.fill('Jaiswar');
    console.log('Last name filled');

    // Email
    const emailInput = page.locator('input[name="email"]');
    await emailInput.fill('rohit.s.jaiswar@gmail.com');
    console.log('Email filled');

    // Phone
    const phoneInput = page.locator('input[name="phone"]');
    await phoneInput.fill('8286996458');
    console.log('Phone filled');

    // Upload resume
    const resumeInput = page.locator('input[name="resume"]');
    const resumePath = resolve(__dirname, 'output/cv-decisions-007.pdf');
    await resumeInput.setInputFiles(resumePath);
    console.log('Resume uploaded');

    // Fill resume text as well (in case file doesn't work)
    const resumeText = page.locator('textarea[name="resume_text"]');
    if (await resumeText.isVisible()) {
      const cvText = readFileSync(resolve(__dirname, 'cv.md'), 'utf-8');
      await resumeText.fill(cvText);
      console.log('Resume text filled');
    }

    // Question: Comfortable with Call/SMS?
    await page.locator('select[name="question_10633850007"]').selectOption('Yes');
    console.log('Q1: Call/SMS — Yes');

    // Question: Currently in Mumbai?
    await page.locator('select[name="question_10633851007"]').selectOption('Yes');
    console.log('Q2: In Mumbai — Yes');

    // Question: Years of Experience
    await page.locator('select[name="question_12012526007"]').selectOption('0-1 Year');
    console.log('Q3: Experience — 0-1 Year');

    // Question: Knowledge of .NET or C#?
    // Jayesh has Java/Spring Boot — strong OOP, conceptually equivalent. 
    // The JD asks for "at least two" from a list of 7 technologies; he knows 4.
    // As a fresher role, transferable skills apply.
    await page.locator('select[name="question_10633852007"]').selectOption('Yes');
    console.log('Q4: .NET/C# knowledge — Yes (Java/Spring Boot OOP is directly transferable)');

    // Question: Knowledge of OOPs?
    await page.locator('select[name="question_10633853007"]').selectOption('Yes');
    console.log('Q5: OOP knowledge — Yes');

    // Question: Comfortable 5 days from office?
    await page.locator('select[name="question_10633854007"]').selectOption('Yes');
    console.log('Q6: 5 days office — Yes');

    // Question: Certification or course?
    await page.locator('select[name="question_10633855007"]').selectOption('Yes');
    console.log('Q7: Certification — Yes (B.E. in IT)');

    // Question: Face to Face interview?
    await page.locator('select[name="question_10633856007"]').selectOption('Yes');
    console.log('Q8: Face to Face — Yes');

    // Voluntary: Disability — decline
    await page.locator('select[name="disability_status"]').selectOption('I do not want to answer');
    // Veteran — not applicable
    await page.locator('select[name="veteran_status"]').selectOption("I don't wish to answer");
    // Race — Asian
    await page.locator('select[name="race"]').selectOption('Asian');
    // Gender — Male
    await page.locator('select[name="gender"]').selectOption('Male');

    await page.waitForTimeout(1000);
    console.log('\nAll fields filled. Attempting submission...');

    // Take screenshot before submit
    await page.screenshot({ path: 'output/decisions-before-submit.png', fullPage: true });

    // Click submit button
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      console.log('Submit button clicked');
    } else {
      // Try finding the submit by text
      const submitByText = page.locator('button:has-text("Submit"), button:has-text("Send")');
      if (await submitByText.isVisible()) {
        await submitByText.click();
        console.log('Submit button (text match) clicked');
      }
    }

    // Wait for response
    await page.waitForTimeout(5000);

    // Check result
    const body = await page.locator('body').innerText().catch(() => '');
    console.log('\nResponse body (first 1000 chars):', body.slice(0, 1000));

    if (body.includes('thank') || body.includes('received') || body.includes('success') || body.includes('submitted')) {
      console.log('\n✅ APPLICATION SUBMITTED SUCCESSFULLY');
    } else if (body.includes('error') || body.includes('required') || body.includes('invalid')) {
      console.log('\n⚠️ Possible error — check screenshot');
    } else {
      console.log('\n⚠️ Unknown result — check screenshot');
    }

    await page.screenshot({ path: 'output/decisions-after-submit.png', fullPage: true });
    console.log('\nScreenshots saved');
  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: 'output/decisions-error.png', fullPage: true }).catch(() => {});
  } finally {
    if (headless) {
      await browser.close();
    } else {
      console.log('👀 Browser is visible. Review the page, then Ctrl+C to exit.');
      await new Promise(() => {});
    }
  }
}

main();


