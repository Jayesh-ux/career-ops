#!/usr/bin/env node
/**
 * submit-all.mjs — Submit to all pending companies
 *
 * One script to:
 *  1. Open Unico Connect careers page → apply to Full Stack / Backend roles
 *  2. Prepare Geekay email application
 *  3. Update tracker after each submission
 *
 * Usage:
 *   node submit-all.mjs              # headless
 *   node submit-all.mjs --show       # visible browser (for OTP)
 *   node submit-all.mjs --email      # only print email drafts
 */

import { launch } from './launch-browser.mjs';
import { existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, 'output/cv-arrk-009.pdf');
const headless = !process.argv.includes('--show');
const onlyEmail = process.argv.includes('--email');

const CANDIDATE = {
  name: 'Jayesh Singh',
  email: 'hsinghjayesh@gmail.com',
  phone: '+91-7821816193',
};

const geekayCover = `Dear Hiring Team,

I am writing to apply for the Junior Software Developer position at Geekay Infotech. I hold a B.E. in Information Technology from Mumbai University and have hands-on experience with Java, Spring Boot, React.js, and PostgreSQL.

During my internship at Qyuki Digital Media, I built production applications using Java/Spring Boot and React, including REST API integrations with secure authentication. I also developed Career Grid, a job platform with Spring Boot microservices deployed on AWS EC2, and Fair Pay Solution, a full-stack loan settlement platform.

I am based in Kalyan and can commute to Byculla. I look forward to the opportunity to contribute to Geekay Infotech's engineering team.

Best regards,
Jayesh Singh`;

const unicoCover = `Dear Hiring Team,

I am writing to express my interest in the Full Stack Engineer role at Unico Connect. I recently completed my B.E. in Information Technology from Mumbai University and have strong hands-on experience with React.js, Node.js, and PostgreSQL — the exact stack mentioned in your job description.

During my internship at Qyuki Digital Media, I built production web applications using Next.js, Django, and Spring Boot. I developed Fair Pay Solution (fairpaysolution.com), a full-stack loan settlement platform with PostgreSQL (Supabase) and Razorpay payment integration. My Career Grid project features a Spring Boot microservices backend with REST APIs, 2FA authentication, and AWS deployment.

I am AI-augmented by default, comfortable with startup pace, and take ownership of my deliverables. As someone based in Kalyan, Kurla is easily commutable. I would love to contribute to Unico Connect's engineering team.

Best regards,
Jayesh Singh`;

async function main() {
  console.log('=== SUBMIT ALL ===\n');

  // Generate cover letter files
  writeFileSync(resolve(__dirname, 'output/cover-geekay.txt'), geekayCover);
  writeFileSync(resolve(__dirname, 'output/cover-unico.txt'), unicoCover);

  // Print email drafts
  console.log('📧 ====== GEEKAY INFOTECH ======');
  console.log('To: careers@geekayinfotech.com');
  console.log('CC: hrhead@geekayinfotech.com');
  console.log('Subject: Application for Junior Software Developer');
  console.log('Attach:', PDF_PATH);
  console.log('');
  console.log(geekayCover);
  console.log('\n');

  console.log('📧 ====== UNICO CONNECT ======');
  console.log('Option 1: Full Stack Engineer (Junior, 1-3 yrs)');
  console.log('To: careers@unicoconnect.com');
  console.log('Subject: Application for Full Stack Engineer');
  console.log('Attach:', PDF_PATH);
  console.log('');
  console.log(unicoCover);
  console.log('\n');

  console.log('Option 2: Software Engineering Intern (Full Stack / AI Track)');
  console.log('To: umama.sayed@unicoconnect.com');
  console.log('Subject: Application for Software Engineering Intern');
  console.log('Attach:', PDF_PATH);
  console.log('');
  console.log(unicoCover);
  console.log('\n');

  if (onlyEmail) {
    console.log('✅ Email drafts printed. Send them from your email client.');
    return;
  }

  // === UNICO CONNECT: Open careers page and find apply links ===
  console.log('🚀 Opening Unico Connect careers page...');
  try {
    const { browser, page } = await launch('https://unicoconnect.com/careers', {
      headless,
      timeout: 45,
    });

    await page.waitForTimeout(5000);

    // Look for the Full Stack Engineer role and click it
    const clicked = await page.evaluate(() => {
      // Try to find role links/buttons
      const allLinks = document.querySelectorAll('a, button, [role=button]');
      for (const el of allLinks) {
        const txt = (el.innerText || el.textContent || '').toLowerCase().trim();
        if (txt.includes('full stack engineer') || txt.includes('backend engineer')) {
          // Check if matches "Junior" level
          const parent = el.closest('div, li, section, article') || el;
          const parentText = (parent.innerText || '').toLowerCase();
          if (parentText.includes('junior') || parentText.includes('0-1') || parentText.includes('1-3')) {
            el.click();
            return txt;
          }
        }
      }
      return 'no-match';
    });

    console.log('📋 Role click result:', clicked);

    if (headless) await browser.close();
    else {
      console.log('👀 Browser open. Review the page, then Ctrl+C.');
      await new Promise(() => {});
    }
  } catch (err) {
    console.log('⚠️  Unico Connect browser error:', err.message);
    console.log('→ Use email draft instead: careers@unicoconnect.com');
  }

  // === GEEKAY: email only (no form found) ===
  console.log('\n✅ Geekay: Email to careers@geekayinfotech.com');
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
