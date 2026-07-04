#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CV_PATH = resolve(__dirname, 'output/cv-jayesh-wohlig.pdf');

async function submitWohlig() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log('1. Navigating to Wohlig Keka...');
    await page.goto('https://wohlig.keka.com/careers/jobdetails/45453', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click Apply
    console.log('2. Clicking Apply...');
    const applyBtn = page.locator('button, a, [role="button"]').filter({ hasText: /apply/i }).first();
    await applyBtn.waitFor({ timeout: 10000 });
    await applyBtn.click();
    await page.waitForTimeout(3000);

    // Upload CV
    console.log('3. Uploading CV...');
    const fileInput = page.locator('#resume-upload').first();
    await fileInput.setInputFiles(CV_PATH);
    console.log('   CV uploaded, waiting for auto-fill...');
    await page.waitForTimeout(3000);

    // Fill all text inputs by placeholder/name/id
    console.log('4. Filling form fields...');
    const allInputs = page.locator('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"])');
    const count = await allInputs.count();
    for (let i = 0; i < count; i++) {
      const inp = allInputs.nth(i);
      const ph = (await inp.getAttribute('placeholder') || '').toLowerCase();
      const id = (await inp.getAttribute('id') || '').toLowerCase();
      const name = (await inp.getAttribute('name') || '').toLowerCase();

      if (ph.includes('first') || id.includes('first') || name.includes('first')) {
        await inp.fill('Jayesh');
        console.log(`   Filled First Name`);
      } else if (ph.includes('last') || id.includes('last') || name.includes('last')) {
        await inp.fill('Singh');
        console.log(`   Filled Last Name`);
      } else if (ph.includes('mobile') || ph.includes('phone') || id.includes('mobile') || name.includes('mobile')) {
        await inp.fill('7821816193');
        console.log(`   Filled Phone`);
      } else if (ph.includes('email') || id.includes('email') || name.includes('email')) {
        await inp.fill('hsinghjayesh@gmail.com');
        console.log(`   Filled Email`);
      }
    }

    // Handle Select2 country code via JS API
    console.log('5. Setting country code via Select2...');
    const countryCodeSet = await page.evaluate(() => {
      try {
        if (typeof $ !== 'undefined' && $('#mobilePhone\\.countryCode').length) {
          $('#mobilePhone\\.countryCode').val('+91').trigger('change');
          return 'jQuery';
        }
        return 'no-jquery';
      } catch (e) { return e.message; }
    });
    console.log(`   Country code set via: ${countryCodeSet}`);

    // Handle other select fields
    console.log('6. Setting select fields...');
    await page.evaluate(() => {
      try {
        // Gender
        const genderEl = document.getElementById('gender');
        if (genderEl) genderEl.value = '1';

        // Work experience months
        const workExp = document.querySelector('select[name="workExperience.months"]');
        if (workExp) workExp.value = '0';

        // Current salary currency - also Select2
        if (typeof $ !== 'undefined' && $('#currentSalary\\.currency').length) {
          $('#currentSalary\\.currency').val('INR').trigger('change');
        }

        // Location preference
        const locPref = document.getElementById('locationPreference');
        if (locPref) locPref.value = 'Mumbai';
      } catch (e) {}
    });

    // Check for consent checkbox
    console.log('7. Checking consent checkbox...');
    const consentCheckbox = page.locator('input[type="checkbox"]').first();
    const cbCount = await page.locator('input[type="checkbox"]').count();
    console.log(`   Found ${cbCount} checkboxes`);
    if (cbCount > 0) {
      const isChecked = await consentCheckbox.isChecked();
      if (!isChecked) {
        await consentCheckbox.check();
        console.log('   Checked consent checkbox');
      }
    }

    // Check for captcha
    console.log('8. Checking for captcha...');
    const hasCaptcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="captcha"], [class*="captcha"], [id*="captcha"]').count();
    console.log(`   Captcha widgets found: ${hasCaptcha}`);

    await page.waitForTimeout(1000);

    // Check submit button state
    const submitBtn = page.locator('#jobApplicationSubmitButton');
    const isDisabled = await submitBtn.isDisabled();
    const btnText = await submitBtn.textContent();
    console.log(`9. Submit button: "${btnText?.trim()}" disabled=${isDisabled}`);

    // Screenshot the filled form
    await page.screenshot({ path: 'output/wohlig-filled.png', fullPage: true });
    console.log('   Screenshot saved to output/wohlig-filled.png');

    // If not disabled, click submit
    if (!isDisabled) {
      await submitBtn.click();
      console.log('10. Submitted!');
      await page.waitForTimeout(5000);
      console.log('    Final URL:', page.url());
      const result = await page.locator('body').innerText();
      console.log('    Result:', result.slice(0, 400));
      await page.screenshot({ path: 'output/wohlig-done.png', fullPage: true });
    } else {
      console.log('10. Submit button is disabled. Form needs captcha/manual completion.');
      console.log('    Open the screenshot at output/wohlig-filled.png to see state.');
    }

  } catch (err) {
    console.error('Error:', err.message);
    try { await page.screenshot({ path: 'output/wohlig-error.png', fullPage: true }); } catch {}
  } finally {
    await browser.close();
  }
}

submitWohlig();
