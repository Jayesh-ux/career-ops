#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('=== mthree Graduate Recruitment Submission ===');
  const browser = await chromium.launch({ headless: true });
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

    // Fill form using evaluate to handle Greenhouse's dynamic form
    await page.evaluate(() => {
      // Helper to fill input by label text
      function fillByLabel(label, value) {
        const labels = document.querySelectorAll('label');
        for (const lbl of labels) {
          if (lbl.textContent.includes(label)) {
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
      }

      // Click checkbox by label
      function clickCheckbox(label) {
        const labels = document.querySelectorAll('label');
        for (const lbl of labels) {
          if (lbl.textContent.trim() === label) {
            const forId = lbl.getAttribute('for');
            if (forId) {
              const cb = document.getElementById(forId);
              if (cb) { cb.click(); return true; }
            }
            // Try clicking the label itself
            lbl.click();
            return true;
          }
        }
        return false;
      }

      // Fill text inputs
      fillByLabel('First Name', 'Jayesh');
      fillByLabel('Last Name', 'Singh');
      fillByLabel('Email', 'hsinghjayesh@gmail.com');
      fillByLabel('Phone', '+917821816193');
      fillByLabel('Location (City)', 'Mumbai');
      fillByLabel('Country', 'India');
      
      // How did you hear about us
      fillByLabel('How did you hear about us', 'Online job search');
      
      // Preferred gender pronouns
      fillByLabel('preferred gender pronouns', 'He/Him');
      
      // Date of birth
      fillByLabel('Date of birth', '2002-06-15');
      
      // Domicile state
      fillByLabel('domicile state', 'Maharashtra');
      
      // Citizenship
      fillByLabel('Citizenship', 'India');
      
      // Undergraduate degree
      fillByLabel('Undergraduate Degree', 'B.E. in Information Technology');
      
      // Major stream
      fillByLabel('major stream', 'Information Technology');
      
      // Year of passing
      fillByLabel('year of passing', '2024');
      
      // College name
      fillByLabel('College Name', 'Mahatma Gandhi Mission, University of Mumbai');
      
      // 60% or more?
      fillByLabel('60%', 'Yes');
      
      // Standing arrears?
      fillByLabel('standing Arrear', 'No');
      
      // Select programming languages: Java, Python
      clickCheckbox('Java');
      clickCheckbox('Python');
      
      // Location: Mumbai
      clickCheckbox('Mumbai');
      
      // Open to relocate?
      fillByLabel('open to Re-locate', 'Yes');
    });

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

  await browser.close();
}

main();
