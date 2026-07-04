#!/usr/bin/env node
/**
 * make-emails.mjs — Generate .eml files for all pending applications
 *
 * Creates .eml files you can tap on your phone to open in Gmail.
 * CV PDF is attached automatically.
 *
 * Usage:
 *   node make-emails.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, 'output/cv-arrk-009.pdf');
const FROM = 'hsinghjayesh@gmail.com';
const FROM_NAME = 'Jayesh Singh';

function makeEml(to, cc, subject, body) {
  const boundary = '==boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '==';
  let eml = `From: ${FROM_NAME} <${FROM}>\r\nTo: ${to}\r\n`;
  if (cc) eml += `Cc: ${cc}\r\n`;
  eml += `Subject: ${subject}\r\n`;
  eml += `MIME-Version: 1.0\r\n`;
  eml += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
  eml += `--${boundary}\r\n`;
  eml += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
  eml += body + '\r\n\r\n';

  if (existsSync(PDF_PATH)) {
    const b64 = readFileSync(PDF_PATH).toString('base64');
    eml += `--${boundary}\r\n`;
    eml += `Content-Type: application/pdf\r\n`;
    eml += `Content-Disposition: attachment; filename="Jayesh_Singh_CV.pdf"\r\n`;
    eml += `Content-Transfer-Encoding: base64\r\n\r\n`;
    for (let i = 0; i < b64.length; i += 76) {
      eml += b64.slice(i, i + 76) + '\r\n';
    }
    eml += `\r\n`;
  }

  eml += `--${boundary}--\r\n`;
  return eml;
}

const EMAILS = [
  {
    slug: 'geekay',
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
    slug: 'unico-fs',
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
    slug: 'unico-intern',
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

for (const email of EMAILS) {
  const eml = makeEml(email.to, email.cc, email.subject, email.body);
  const path = resolve(__dirname, `output/${email.slug}.eml`);
  writeFileSync(path, eml);
  console.log(`✅ Created: output/${email.slug}.eml`);
}

console.log('\n📧 To send: tap each .eml file on your phone → opens in Gmail app → tap Send');
console.log('   Files are in: /root/career-ops/output/');
console.log('   Or use termux-open: termux-open output/geekay.eml');
