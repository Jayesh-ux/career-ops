#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('=== mthree Graduate Recruitment Submission ===');
  const headless = !process.argv.includes('--show');
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto('https://job-boards.greenhouse.io/mthreerecruitingportal/jobs/4660233006', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    console.log('Page loaded');

    // Click Apply
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(3000);
    console.log('Apply clicked');

    // Expose helpers globally on window
    await page.evaluate(() => {
      window.fillByLabel = function(label, value) {
        const labels = document.querySelectorAll('label');
        for (const lbl of labels) {
          if (lbl.textContent.toLowerCase().includes(label.toLowerCase())) {
            const forId = lbl.getAttribute('for');
            if (forId) {
              const input = document.getElementById(forId);
              if (input) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
          }
        }
        return false;
      };

      window.clickCheckbox = function(label) {
        const labels = document.querySelectorAll('label');
        for (const lbl of labels) {
          if (lbl.textContent.trim().toLowerCase() === label.toLowerCase() || lbl.textContent.toLowerCase().includes(label.toLowerCase())) {
            const forId = lbl.getAttribute('for');
            if (forId) {
              const cb = document.getElementById(forId);
              if (cb) { cb.click(); return true; }
            }
            lbl.click();
            return true;
          }
        }
        return false;
      };
    });

    const fill = async (label, value) => {
      await page.evaluate(({ label, value }) => window.fillByLabel(label, value), { label, value });
      console.log(`   Filled ${label}`);
      await page.waitForTimeout(1500);
    };

    const check = async (label) => {
      await page.evaluate((label) => window.clickCheckbox(label), label);
      console.log(`   Checked ${label}`);
      await page.waitForTimeout(1500);
    };

    console.log('4. Filling form fields with pacing...');
    await fill('First Name', 'Rohit');
    await fill('Last Name', 'Jaiswar');
    await fill('Email', 'rohit.s.jaiswar@gmail.com');
    await fill('Phone', '8286996458');
    await fill('Location (City)', 'Mumbai');
    await fill('Country', 'India');
    await fill('How did you hear about us', 'Online job search');
    await fill('preferred gender pronouns', 'He/Him');
    await fill('Date of birth', '2000-01-01');
    await fill('domicile state', 'Maharashtra');
    await fill('Citizenship', 'India');
    await fill('Undergraduate Degree', 'B.E. in Information Technology');
    await fill('major stream', 'Information Technology');
    await fill('year of passing', '2022');
    await fill('College Name', 'Armiet College, University of Mumbai');
    await fill('60%', 'Yes');
    await fill('standing Arrear', 'No');
    await check('Java');
    await check('Python');
    await check('Mumbai');
    await fill('open to Re-locate', 'Yes');

    await page.waitForTimeout(1000);
    console.log('Form fields filled');

    // Upload resume
    const fileInputs = await page.locator('input[type="file"]');
    const count = await fileInputs.count();
    for (let i = 0; i < count; i++) {
      const name = await fileInputs.nth(i).getAttribute('name');
      const accept = await fileInputs.nth(i).getAttribute('accept') || '';
      if (accept.includes('pdf') || accept.includes('doc') || (!name) || name === 'resume' || name.includes('resume')) {
        const resumePath = resolve(__dirname, 'output/cv-decisions-007.pdf');
        await fileInputs.nth(i).setInputFiles(resumePath);
        console.log('Resume uploaded to input', i);
        break;
      }
    }

    await page.waitForTimeout(1000);
    console.log('Resume uploaded');

    // Check consent checkboxes
    await page.evaluate(() => {
      function clickCheckbox(label) {
        const labels = document.querySelectorAll('label');
        for (const lbl of labels) {
          if (lbl.textContent.includes(label)) {
            const forId = lbl.getAttribute('for');
            if (forId) {
              const cb = document.getElementById(forId);
              if (cb) { cb.click(); return true; }
            }
            lbl.click();
            return true;
          }
        }
        return false;
      }
      
      // Authorize SMS
      clickCheckbox('authorize mthree');
      clickCheckbox('Privacy Policy');
      clickCheckbox('store and process');
    });

    await page.waitForTimeout(1000);
    console.log('Consents checked');

    // Take screenshot before submit
    await page.screenshot({ path: 'output/mthree-before-submit.png', fullPage: true });

    // Click submit
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      console.log('Submit clicked');
    }

    await page.waitForTimeout(5000);

    // Check result
    const body = await page.locator('body').innerText().catch(() => '');
    if (body.toLowerCase().includes('thank') || body.toLowerCase().includes('received') || 
        body.toLowerCase().includes('success') || body.toLowerCase().includes('submitted')) {
      console.log('\n✅ APPLICATION SUBMITTED SUCCESSFULLY');
    } else {
      console.log('\n⚠️ Check result - body first 500:', body.substring(0, 500));
    }

    await page.screenshot({ path: 'output/mthree-after-submit.png', fullPage: true });
    console.log('Screenshots saved');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: 'output/mthree-error.png', fullPage: true }).catch(() => {});
  }

  if (headless) {
    await browser.close();
  } else {
    console.log('👀 Browser is visible. Review the page, then Ctrl+C to exit.');
    await new Promise(() => {});
  }
}

main();
