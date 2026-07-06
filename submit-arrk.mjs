#!/usr/bin/env node
/**
 * submit-arrk.mjs — Submit application to Arrk Group via online form
 *
 * Uses the stealth Chromium launcher to fill the Ninja Forms modal
 * on the Arrk Group careers page.
 *
 * Usage:
 *   node submit-arrk.mjs              # headless (auto)
 *   node submit-arrk.mjs --show       # visible browser (for debugging/OTP)
 *
 * Falls back to preparing email draft if form submission fails.
 */

import { launch } from './launch-browser.mjs';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = 'https://www.arrkgroup.com/job/junior-software-developer-fresher/';
const PDF_PATH = resolve(__dirname, 'output/cv-arrk-009.pdf');
const HTML_PATH = resolve(__dirname, 'output/cv-arrk.html');

const CANDIDATE = {
  name: 'Rohit Shankarram Jaiswar',
  email: 'rohit.s.jaiswar@gmail.com',
  phone: '8286996458',
  coverLetter: `Dear Hiring Team,

I am writing to apply for the Junior Software Developer position at Arrk Group. I recently completed my B.E. in Information Technology from Mumbai University and have strong hands-on experience in Next.js, React, Java, Spring Boot, and Firebase.

I built ClockHustle (clockhustle.com), an AI-powered SaaS platform that automates 30% of project scope creep detection using Gemini AI. I also developed a real-time Ambulance Dispatch System using Firebase Authentication, Firestore, and Google Maps API. My projects demonstrate full-stack ownership from database schemas to cloud deployments.

I am based in Mumbai and look forward to the opportunity to contribute to Arrk Group's engineering team.

Best regards,
Rohit Shankarram Jaiswar`,
};

// Write cover letter as a temp file for upload (Arrk expects it as file)
const COVER_LETTER_PATH = resolve(__dirname, 'output/cover-letter-arrk.txt');
import { writeFileSync } from 'fs';
writeFileSync(COVER_LETTER_PATH, CANDIDATE.coverLetter);

async function submit() {
  const headless = !process.argv.includes('--show');
  console.log(`🚀 Launching browser (${headless ? 'headless' : 'visible'})...`);

  const { browser, page } = await launch(URL, {
    headless,
    timeout: 45,
  });

  try {
    // Wait for page to fully render
    await page.waitForTimeout(3000);

    // Check for an "Apply" button to open the modal
    console.log('🔍 Looking for apply trigger...');
    const applyClicked = await page.evaluate(() => {
      const triggers = [
        ...document.querySelectorAll('a, button, .button, [class*=apply], [id*=apply]'),
      ];
      const applyBtn = triggers.find(el =>
        (el.innerText || el.textContent || '').toLowerCase().includes('apply')
      );
      if (applyBtn) {
        applyBtn.click();
        return true;
      }
      return false;
    });

    if (!applyClicked) {
      console.log('⚠️  Apply button not found. Trying modal trigger...');
      // Try clicking any popup-maker trigger for this job
      await page.evaluate(() => {
        const popupTriggers = document.querySelectorAll('[data-popup-id], .popmake-apply, a[href*="apply"]');
        popupTriggers.forEach(el => el.click());
      });
    }

    // Wait for modal/Ninja Form to appear
    await page.waitForTimeout(3000);

    // Check what's visible
    const pageState = await page.evaluate(() => {
      const form = document.querySelector('form');
      const inputs = form
        ? Array.from(form.querySelectorAll('input, textarea, select')).map(el => ({
            name: el.name || el.id,
            type: el.type || 'text',
            placeholder: el.placeholder || '',
            required: el.required,
          }))
        : [];
      const modalVisible = document.querySelector('.pum-overlay.pum-active, .mfp-wrap, [class*=modal][style*="block"]') !== null;
      return { hasForm: !!form, inputs, modalVisible };
    });

    console.log('📋 Page state:', JSON.stringify(pageState, null, 2));

    if (!pageState.hasForm) {
      console.log('⚠️  Form not found. Taking screenshot and preparing email fallback...');
      await page.screenshot({ path: resolve(__dirname, 'output/arrk-form-error.png'), fullPage: true });
      printEmailFallback();
      return;
    }

    // Fill the form
    console.log('📝 Filling application form...');
    const filled = await page.evaluate((data) => {
      const form = document.querySelector('form');
      if (!form) return 'no-form';

      const inputs = form.querySelectorAll('input, textarea');
      const results = { filled: [], missed: [] };

      inputs.forEach(el => {
        const name = (el.name || el.id || '').toLowerCase();
        const placeholder = (el.placeholder || '').toLowerCase();
        const type = el.type || 'text';

        // Skip honeypot fields
        if (name.includes('honeypot')) {
          results.filled.push('honeypot-skipped');
          return;
        }
        // Skip hidden fields
        if (type === 'hidden') {
          results.missed.push(name);
          return;
        }

        if (name.includes('name') || placeholder.includes('name') || placeholder.includes('your name')) {
          el.value = data.name;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          results.filled.push('name');
        } else if (name.includes('email') || placeholder.includes('email') || placeholder.includes('e-mail')) {
          el.value = data.email;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          results.filled.push('email');
        } else if (name.includes('phone') || name.includes('contact')) {
          // Only fill if NOT a honeypot (honeypot often has placeholder "Phone")
          if (!name.includes('honeypot')) {
            el.value = data.phone;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            results.filled.push('phone');
          } else {
            results.filled.push('phone-honeypot-skipped');
          }
        } else if (type === 'file') {
          results.filled.push('file-input:' + name);
        } else if (type === 'textarea' || placeholder.includes('cover') || placeholder.includes('message')) {
          el.value = data.coverLetter;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          results.filled.push('cover-letter');
        } else {
          results.missed.push(name || placeholder);
        }
      });

      return results;
    }, CANDIDATE);

    console.log('✅ Form filled:', JSON.stringify(filled));

    // Upload files (CV + cover letter)
    const fileInputs = await page.$$('input[type="file"]');
    for (const fi of fileInputs) {
      const name = await fi.evaluate(el => (el.name || el.id || '').toLowerCase());
      if (name.includes('cv') || name.includes('resume') || name.includes('file_cv')) {
        if (existsSync(PDF_PATH)) {
          await fi.setInputFiles(PDF_PATH);
          console.log('✅ Resume uploaded:', PDF_PATH);
        } else {
          console.log('⚠️  PDF not found at', PDF_PATH);
        }
      } else if (name.includes('cover') || name.includes('letter')) {
        if (existsSync(COVER_LETTER_PATH)) {
          await fi.setInputFiles(COVER_LETTER_PATH);
          console.log('✅ Cover letter uploaded:', COVER_LETTER_PATH);
        }
      } else {
        console.log('⚠️  Unknown file input:', name);
      }
    }

    // Take pre-submit screenshot
    await page.screenshot({ path: resolve(__dirname, 'output/arrk-before-submit.png'), fullPage: true });

    // Find and click submit
    console.log('🔍 Looking for submit button...');
    const submitted = await page.evaluate(() => {
      // Log all buttons on the page for debugging
      const allElements = document.querySelectorAll('button, input[type=submit], input[type=button], .nf-element, .nf-form-content button');
      const candidates = Array.from(allElements).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        class: el.className.slice(0, 60),
        text: (el.innerText || el.value || '').trim().slice(0, 40),
        id: el.id || '',
        visible: el.offsetParent !== null,
        href: el.href || '',
      }));

      // Save candidates for logging
      window.__btnCandidates = candidates;

      // Try submit types first (visible ones)
      for (const el of allElements) {
        if (el.offsetParent === null) continue;
        const txt = (el.innerText || el.value || '').toLowerCase().trim();
        if (txt === 'send application' || txt === 'send' || txt === 'submit') {
          el.click(); return true;
        }
      }

      // Try first visible button inside the form
      const form = document.querySelector('form');
      if (form) {
        const formBtns = form.querySelectorAll('button, input[type=submit], input[type=button]');
        for (const btn of formBtns) {
          if (btn.offsetParent !== null) { btn.click(); return true; }
        }
      }

      return false;
    });

    // Log button candidates for debugging
    const candidates = await page.evaluate(() => window.__btnCandidates || []);
    console.log('Button candidates:', JSON.stringify(candidates, null, 2));

    if (submitted) {
      console.log('✅ Form submitted! Waiting for confirmation...');
      await page.waitForTimeout(5000);
      await page.screenshot({ path: resolve(__dirname, 'output/arrk-after-submit.png'), fullPage: true });
      console.log('✅ Screenshot saved to output/arrk-after-submit.png');
      const confirmText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      console.log('📄 Confirmation:', confirmText);
    } else {
      console.log('⚠️  Could not find submit button.');
      console.log('📋 Button candidates on page:', JSON.stringify(candidates, null, 2));
      if (!headless) {
        console.log('👀 Browser window is visible. Please check the form and submit manually, then press Ctrl+C.');
        await new Promise(() => {}); // hang until Ctrl+C
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    printEmailFallback();
  } finally {
    if (headless) await browser.close();
  }
}

function printEmailFallback() {
  console.log(`
📧 EMAIL FALLBACK — Send this email yourself:

To: tanaya.ganguli@arrkgroup.com
Subject: Application – Junior Software Developer (Fresher)

Attach: ${PDF_PATH}

${CANDIDATE.coverLetter}
`);
}

submit().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
