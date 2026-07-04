#!/usr/bin/env node
/**
 * send-email.mjs — Send application emails via Gmail in the browser
 *
 * Requires: You're already logged into Gmail in system Chromium.
 * Opens Gmail, clicks Compose, fills To/Subject/Body, attaches PDF.
 *
 * Usage:
 *   node send-email.mjs <company> [--show]
 *
 * Companies: geekay, unico, unico-intern
 */

import { launch } from './launch-browser.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, 'output/cv-arrk-009.pdf');
const headless = !process.argv.includes('--show');

const APPS = {
  geekay: {
    to: 'careers@geekayinfotech.com',
    cc: 'hrhead@geekayinfotech.com',
    subject: 'Application for Junior Software Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Junior Software Developer position at Geekay Infotech. I hold a B.E. in Information Technology from Mumbai University and have hands-on experience with Java, Spring Boot, React.js, and PostgreSQL.

During my internship at Qyuki Digital Media, I built production applications using Java/Spring Boot and React, including REST API integrations with secure authentication. I also developed Career Grid, a job platform with Spring Boot microservices deployed on AWS EC2, and Fair Pay Solution, a full-stack loan settlement platform.

I am based in Kalyan and can commute to Byculla. I look forward to the opportunity to contribute to Geekay Infotech's engineering team.

Best regards,
Jayesh Singh
+91-7821816193
hsinghjayesh@gmail.com`,
  },
  unico: {
    to: 'careers@unicoconnect.com',
    cc: '',
    subject: 'Application for Full Stack Engineer',
    body: `Dear Hiring Team,

I am writing to express my interest in the Full Stack Engineer role at Unico Connect. I recently completed my B.E. in Information Technology from Mumbai University and have strong hands-on experience with React.js, Node.js, and PostgreSQL.

During my internship at Qyuki Digital Media, I built production web applications using Next.js, Django, and Spring Boot. I developed Fair Pay Solution (fairpaysolution.com), a full-stack loan settlement platform with PostgreSQL (Supabase) and Razorpay. My Career Grid project features a Spring Boot microservices backend with REST APIs, 2FA authentication, and AWS deployment.

I am AI-augmented by default, comfortable with startup pace, and take ownership of deliverables. Based in Kalyan, Kurla is easily commutable.

Best regards,
Jayesh Singh
+91-7821816193
hsinghjayesh@gmail.com`,
  },
  'unico-intern': {
    to: 'umama.sayed@unicoconnect.com',
    cc: '',
    subject: 'Application for Software Engineering Intern (Full Stack / AI Track)',
    body: `Dear Umama,

I am writing to apply for the Software Engineering Intern (Full Stack / AI Track) at Unico Connect. I recently completed my B.E. in Information Technology from Mumbai University.

I have hands-on experience building full-stack applications with React.js, Node.js, and PostgreSQL. At Qyuki Digital Media, I built production dashboards and web apps. I developed Fair Pay Solution (fairpaysolution.com), a full loan settlement platform, and Career Grid, a job platform with Spring Boot microservices on AWS.

I have AI/ML exposure including model fine-tuning (Gemma Vision), n8n automation pipelines, and Langchain concepts. I'm eager to apply my skills at Unico Connect.

Best regards,
Jayesh Singh
+91-7821816193
hsinghjayesh@gmail.com`,
  },
};

async function sendEmail(company) {
  const cfg = APPS[company];
  if (!cfg) {
    console.error(`Unknown company: ${company}. Options: ${Object.keys(APPS).join(', ')}`);
    process.exit(1);
  }

  console.log(`📧 Sending email for ${company}...`);
  console.log(`To: ${cfg.to}`);
  if (cfg.cc) console.log(`CC: ${cfg.cc}`);
  console.log(`Subject: ${cfg.subject}`);
  console.log(`Attach: ${PDF_PATH}\n`);

  const { browser, page } = await launch('https://mail.google.com', {
    headless,
    timeout: 60,
  });

  try {
    // Wait for Gmail to load
    console.log('⏳ Waiting for Gmail to load...');
    await page.waitForTimeout(8000);

    // Check if we're logged in
    const loggedIn = await page.evaluate(() => {
      return document.querySelector('a[href*="SignOut"], a[href*="signout"], [aria-label*="Account"], [aria-label*="Google Account"]') !== null
        || document.querySelector('div[role="button"][gh="cm"]') !== null;
    });

    if (!loggedIn) {
      console.log('⚠️  Not logged into Gmail.');
      if (!headless) {
        console.log('👀 Please log in to Gmail in the browser window, then press Enter here.');
        await new Promise(resolve => {
          process.stdin.once('data', resolve);
        });
      } else {
        console.log('❌ Cannot send email headless without an active session.');
        console.log('   Run with --show to log in manually.');
        return;
      }
    }

    // Click Compose
    console.log('📝 Clicking Compose...');
    const composeClicked = await page.evaluate(() => {
      const composeBtn = document.querySelector('div[gh="cm"], div[role="button"][gh="cm"], .T-I.T-I-KE.L3');
      if (composeBtn) { composeBtn.click(); return true; }
      return false;
    });

    if (!composeClicked) {
      console.log('❌ Could not find Compose button.');
      return;
    }

    await page.waitForTimeout(3000);

    // Fill To field
    const toField = await page.$('textarea[name="to"], input[name="to"], div[aria-label*="To"]');
    if (toField) {
      await toField.click();
      await toField.fill(cfg.to);
      console.log('✅ To field filled');
    }

    await page.waitForTimeout(1000);

    // Fill CC if needed
    if (cfg.cc) {
      const ccField = await page.$('input[name="cc"], div[aria-label*="Cc"]');
      if (ccField) {
        await ccField.fill(cfg.cc);
        console.log('✅ CC field filled');
      }
    }

    // Fill Subject
    const subjectField = await page.$('input[name="subjectbox"], input[name="subject"], input[placeholder*="Subject"]');
    if (subjectField) {
      await subjectField.fill(cfg.subject);
      console.log('✅ Subject filled');
    }

    // Fill Body
    const bodyField = await page.$('div[aria-label*="Message Body"], div[role="textbox"][aria-label*="Body"], div.editable');
    if (bodyField) {
      await bodyField.click();
      await page.keyboard.type(cfg.body, { delay: 10 });
      console.log('✅ Body filled');
    }

    // Upload attachment
    const fileInput = await page.$('input[type="file"][accept*="pdf"], input[type="file"][accept*="document"]');
    if (fileInput) {
      await fileInput.setInputFiles(PDF_PATH);
      console.log('✅ PDF attached');
    } else {
      // Try clicking the attach button then finding the input
      const attachBtn = await page.$('div[aria-label*="Attach"], div[command*="Files"], .aaA');
      if (attachBtn) {
        await attachBtn.click();
        await page.waitForTimeout(2000);
        const fileInput2 = await page.$('input[type="file"]');
        if (fileInput2) {
          await fileInput2.setInputFiles(PDF_PATH);
          console.log('✅ PDF attached via button');
        }
      }
    }

    // Pause for review (always show mode)
    console.log('\n✅ Email ready for review!');
    console.log('📋 Check the compose window on screen.');
    if (!headless) {
      console.log('👀 Review and click Send manually, then Ctrl+C.');
      await new Promise(() => {});
    } else {
      // Try clicking Send
      const sendBtn = await page.$('div[aria-label*="Send"], div[role="button"][data-tooltip*="Send"]');
      if (sendBtn) {
        await sendBtn.click();
        console.log('✅ Sent!');
        await page.waitForTimeout(3000);
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    if (headless) await browser.close();
  }
}

// CLI
const company = process.argv.find(a => Object.keys(APPS).includes(a));
if (!company) {
  console.log('Usage: node send-email.mjs <company> [--show]');
  console.log(`Companies: ${Object.keys(APPS).join(', ')}`);
  process.exit(1);
}

sendEmail(company).catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
