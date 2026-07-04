#!/usr/bin/env node
/**
 * send-emails-smtp.mjs — Send application emails via Gmail SMTP
 *
 * Uses Node.js built-in TLS module (zero dependencies).
 * Requires a Google App Password.
 *
 * Usage:
 *   node send-emails-smtp.mjs <your-email> <app-password>
 *
 * Steps:
 *   1. Enable 2FA: https://myaccount.google.com/security
 *   2. Generate App Password: https://myaccount.google.com/apppasswords
 *   3. Run this script
 *
 * Example:
 *   node send-emails-smtp.mjs hsinghjayesh@gmail.com xxxx yyyy zzzz aaaa
 */

import * as tls from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, 'output/cv-arrk-009.pdf');

const [, , USER_EMAIL, APP_PASSWORD] = process.argv;

if (!USER_EMAIL || !APP_PASSWORD) {
  console.log('Usage: node send-emails-smtp.mjs <your-email> <app-password>\n');
  console.log('1. Enable 2FA: https://myaccount.google.com/security');
  console.log('2. Generate App Password: https://myaccount.google.com/apppasswords');
  console.log('3. Run this script\n');
  process.exit(1);
}

const HOST = 'smtp.gmail.com';
const PORT = 465;
const FROM_NAME = 'Jayesh Singh';

function smtpSend(to, cc, subject, body, pdfBuffer) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(PORT, HOST, () => {
      socket.setTimeout(15000);
    });

    let step = 0;
    let buffer = '';
    let mailSent = false;

    // Build MIME message
    const boundary = '==boundary_' + Date.now() + '==';
    let message = `From: ${FROM_NAME} <${USER_EMAIL}>\r\nTo: ${to}\r\n`;

    if (cc) message += `Cc: ${cc}\r\n`;
    message += `Subject: =?UTF-8?Q?${encodeSubject(subject)}?=\r\n`;
    message += `MIME-Version: 1.0\r\n`;
    message += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
    message += `${body}\r\n\r\n`;

    if (pdfBuffer) {
      const b64 = pdfBuffer.toString('base64');
      message += `--${boundary}\r\n`;
      message += `Content-Type: application/pdf\r\n`;
      message += `Content-Disposition: attachment; filename="Jayesh_Singh_CV.pdf"\r\n`;
      message += `Content-Transfer-Encoding: base64\r\n\r\n`;
      // Split base64 into 76-char lines
      for (let i = 0; i < b64.length; i += 76) {
        message += b64.slice(i, i + 76) + '\r\n';
      }
      message += `\r\n`;
    }

    message += `--${boundary}--\r\n`;
    const msgBytes = Buffer.from(message, 'utf-8');

    function sendCommand(cmd) {
      socket.write(cmd + '\r\n');
    }

    function log(msg) {
      process.stderr.write(`  ${msg}\n`);
    }

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (step === 0 && line.startsWith('220 ')) {
          step = 1;
          sendCommand(`EHLO career-ops`);
        } else if (step === 1 && (line.startsWith('250 ') || line.startsWith('250-'))) {
          if (line.includes('AUTH') || line.startsWith('250 ')) {
            step = 2;
            sendCommand(`AUTH LOGIN`);
          }
        } else if (step === 2 && line.startsWith('334 ')) {
          step = 3;
          sendCommand(Buffer.from(USER_EMAIL).toString('base64'));
        } else if (step === 3 && line.startsWith('334 ')) {
          step = 4;
          sendCommand(Buffer.from(APP_PASSWORD).toString('base64'));
        } else if (step === 4 && line.startsWith('235 ')) {
          step = 5;
          log('✅ Authenticated');
          sendCommand(`MAIL FROM:<${USER_EMAIL}>`);
        } else if (step === 5 && line.startsWith('250 ')) {
          step = 6;
          sendCommand(`RCPT TO:<${to}>`);
        } else if (step === 6 && line.startsWith('250 ')) {
          if (cc) {
            step = 7;
            sendCommand(`RCPT TO:<${cc}>`);
          } else {
            step = 8;
            sendCommand('DATA');
          }
        } else if (step === 7 && line.startsWith('250 ')) {
          step = 8;
          sendCommand('DATA');
        } else if (step === 8 && line.startsWith('354 ')) {
          step = 9;
          socket.write(msgBytes);
          socket.write('\r\n.\r\n');
        } else if (step === 9 && line.startsWith('250 ')) {
          mailSent = true;
          log('✅ Email accepted by server');
          sendCommand('QUIT');
        } else if (line.startsWith('535 ') || line.includes('Authentication failed')) {
          reject(new Error('Authentication failed. Check your email and app password.'));
          socket.end();
        } else if (line.startsWith('550 ') || line.startsWith('554 ')) {
          reject(new Error('Rejected: ' + line));
          socket.end();
        }
      }
    });

    socket.on('error', (err) => reject(err));
    socket.on('timeout', () => reject(new Error('Connection timed out')));

    socket.on('close', () => {
      if (mailSent) resolve();
      else if (!mailSent && step > 0) reject(new Error('Connection closed before email was accepted'));
    });
  });
}

function encodeSubject(subject) {
  let result = '';
  for (let i = 0; i < subject.length; i++) {
    const c = subject.charCodeAt(i);
    if (c > 127 || c === 61 || c === 63 || c === 95) {
      const hex = subject.charCodeAt(i).toString(16).toUpperCase();
      result += '=' + (hex.length === 1 ? '0' : '') + hex;
    } else {
      result += subject[i];
    }
  }
  return result;
}

const EMAILS = [
  {
    company: 'Geekay Infotech',
    to: 'careers@geekayinfotech.com',
    cc: 'hrhead@geekayinfotech.com',
    subject: 'Application for Junior Software Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Junior Software Developer position at Geekay Infotech. I hold a B.E. in Information Technology from Mumbai University and have hands-on experience with Java, Spring Boot, React.js, and PostgreSQL.

During my internship at Qyuki Digital Media, I built production applications using Java/Spring Boot and React, including REST API integrations with secure authentication. I also developed Career Grid, a job platform with Spring Boot microservices deployed on AWS EC2, and Fair Pay Solution, a full-stack loan settlement platform.

I am based in Kalyan and can commute to Byculla. I look forward to the opportunity to contribute to Geekay Infotech's team.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Unico Connect - Full Stack Engineer',
    to: 'careers@unicoconnect.com',
    subject: 'Application for Full Stack Engineer',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Engineer role at Unico Connect. I hold a B.E. in Information Technology from Mumbai University and have strong hands-on experience with React.js, Node.js, and PostgreSQL.

During my internship at Qyuki Digital Media, I built production applications using Next.js, Django, and Spring Boot. I developed Fair Pay Solution (fairpaysolution.com), a full-stack loan settlement platform with PostgreSQL (Supabase) and Razorpay. My Career Grid project features Spring Boot microservices with REST APIs, 2FA authentication, and AWS deployment.

I am AI-augmented by default and take ownership of deliverables. Based in Kalyan, Kurla is easily commutable.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Unico Connect - Internship',
    to: 'umama.sayed@unicoconnect.com',
    subject: 'Application for Software Engineering Intern (Full Stack / AI Track)',
    body: `Dear Umama,

I am writing to apply for the Software Engineering Intern (Full Stack / AI Track) at Unico Connect. I recently completed my B.E. in Information Technology from Mumbai University.

I have hands-on experience building full-stack applications with React.js, Node.js, and PostgreSQL. At Qyuki Digital Media, I built production dashboards and web apps. I developed Fair Pay Solution (fairpaysolution.com) and Career Grid, a job platform with Spring Boot microservices on AWS.

I have AI/ML exposure including model fine-tuning (Gemma Vision), n8n automation pipelines, and Langchain concepts.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
];

(async () => {
  if (!existsSync(PDF_PATH)) {
    console.log(`⚠️  CV PDF not found at ${PDF_PATH}`);
    console.log('   Emails will be sent without attachment.');
  }

  const pdfBuffer = existsSync(PDF_PATH) ? readFileSync(PDF_PATH) : null;
  let sent = 0;
  let failed = 0;

  for (const email of EMAILS) {
    console.log(`\n📧 Sending to ${email.company}...`);
    console.log(`   To: ${email.to}${email.cc ? `\n   CC: ${email.cc}` : ''}`);
    process.stdout.write('   ');

    try {
      await smtpSend(email.to, email.cc, email.subject, email.body, pdfBuffer);
      console.log('✅ Sent!');
      sent++;
    } catch (err) {
      console.error(`❌ ${err.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== Done: ${sent} sent, ${failed} failed ===`);

  if (failed > 0) {
    console.log('\nTroubleshooting:');
    console.log('1. Make sure 2-Step Verification is ON at https://myaccount.google.com/security');
    console.log('2. Generate App Password at https://myaccount.google.com/apppasswords');
    console.log('3. Use the 16-char password (without spaces) as the second argument');
    console.log('4. If "Username and Password not accepted" — generate a NEW app password');
  } else {
    console.log('\n🎉 All emails sent! Update tracker with:');
    console.log('   node -e "... mark geekay & unico as Applied ...');
  }
})();
