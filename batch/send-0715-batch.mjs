#!/usr/bin/env node
import * as tls from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, '..', 'output/cv-jayesh-generic.pdf');
const [, , USER_EMAIL, APP_PASSWORD] = process.argv;

if (!USER_EMAIL || !APP_PASSWORD) {
  console.log('Usage: node send-0715-batch.mjs <email> <app-password>');
  process.exit(1);
}

const HOST = 'smtp.gmail.com';
const PORT = 465;
const FROM_NAME = 'Jayesh Singh';

function smtpSend(to, cc, subject, body, pdfBuffer) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(PORT, HOST, () => socket.setTimeout(15000));
    let step = 0, buffer = '', mailSent = false;

    const boundary = '==boundary_' + Date.now() + '==';
    let message = `From: ${FROM_NAME} <${USER_EMAIL}>\r\nTo: ${to}\r\n`;
    if (cc) message += `Cc: ${cc}\r\n`;
    message += `Subject: =?UTF-8?Q?${encodeSubject(subject)}?=\r\n`;
    message += `MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    message += `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n\r\n`;
    if (pdfBuffer) {
      const b64 = pdfBuffer.toString('base64');
      message += `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="Jayesh_Singh_CV.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
      for (let i = 0; i < b64.length; i += 76) message += b64.slice(i, i + 76) + '\r\n';
      message += `\r\n`;
    }
    message += `--${boundary}--\r\n`;
    const msgBytes = Buffer.from(message, 'utf-8');

    function sc(cmd) { socket.write(cmd + '\r\n'); }

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (step === 0 && line.startsWith('220 ')) { step = 1; sc('EHLO career-ops'); }
        else if (step === 1 && (line.startsWith('250 ') || line.startsWith('250-'))) { if (line.includes('AUTH') || line.startsWith('250 ')) { step = 2; sc('AUTH LOGIN'); } }
        else if (step === 2 && line.startsWith('334 ')) { step = 3; sc(Buffer.from(USER_EMAIL).toString('base64')); }
        else if (step === 3 && line.startsWith('334 ')) { step = 4; sc(Buffer.from(APP_PASSWORD).toString('base64')); }
        else if (step === 4 && line.startsWith('235 ')) { step = 5; process.stderr.write('  \u2705 Authenticated\n'); sc(`MAIL FROM:<${USER_EMAIL}>`); }
        else if (step === 5 && line.startsWith('250 ')) { step = 6; sc(`RCPT TO:<${to}>`); }
        else if (step === 6 && line.startsWith('250 ')) { if (cc) { step = 7; sc(`RCPT TO:<${cc}>`); } else { step = 8; sc('DATA'); } }
        else if (step === 7 && line.startsWith('250 ')) { step = 8; sc('DATA'); }
        else if (step === 8 && line.startsWith('354 ')) { step = 9; socket.write(msgBytes); socket.write('\r\n.\r\n'); }
        else if (step === 9 && line.startsWith('250 ')) { mailSent = true; sc('QUIT'); }
        else if (line.startsWith('535 ') || line.includes('Authentication failed')) { reject(new Error('Auth failed')); socket.end(); }
        else if (line.startsWith('550 ') || line.startsWith('554 ')) { reject(new Error('Rejected: ' + line)); socket.end(); }
      }
    });
    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('Timeout')));
    socket.on('close', () => { if (mailSent) resolve(); else if (!mailSent && step > 0) reject(new Error('Closed before accepted')); });
  });
}

function encodeSubject(subject) {
  let result = '';
  for (let i = 0; i < subject.length; i++) {
    const c = subject.charCodeAt(i);
    if (c > 127 || c === 61 || c === 63 || c === 95) {
      const hex = subject.charCodeAt(i).toString(16).toUpperCase();
      result += '=' + (hex.length === 1 ? '0' : '') + hex;
    } else result += subject[i];
  }
  return result;
}

const EMAILS = [
  {
    company: 'AutomateBuddy Technologies',
    to: 'info@automatebuddy.com',
    subject: 'Application for Web Developer Intern',
    body: `Dear Hiring Team,

I am writing to apply for the Web Developer Intern position at AutomateBuddy Technologies. I am a Full Stack Developer with hands-on experience building production web applications using React.js, Next.js, Node.js, and PostgreSQL.

During my internship at DeepSoch AI and through my projects (Fair Pay Solution with 700+ clients, GeoTrack real-time GPS tracking, Career Grid job portal), I have built and deployed full-stack applications end-to-end on AWS and Vercel.

Key highlights:
- Built fairpaysolution.com — fintech platform with Razorpay, Google OAuth, RBAC, deployed on AWS
- Developed Career Grid — Spring Boot + React job portal with 2FA, microservices
- Built GeoTrack — Node.js + PostGIS real-time GPS tracking (~40% API cost reduction)
- B.E. in Information Technology, University of Mumbai (2024)

I am based in Kalyan, and Navi Mumbai (Vashi) is easily commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Cybotrix Technologies',
    to: 'contact@cybotrix.com',
    subject: 'Application for Full Stack / Web Developer Opportunities',
    body: `Dear Team,

I am reaching out to register as a candidate with Cybotrix Technologies for full-time or internship opportunities in web development / full stack development.

I am a Full Stack Developer with experience in React.js, Next.js, Node.js, Express, Python, PostgreSQL, MongoDB, and AWS. I have 27+ public repositories and three core production projects — FairPay Solution (700+ clients, ₹50Cr+ debt resolved), GeoTrack (real-time GPS tracking), and OfferGhost (recruitment pipeline).

I am based in Kalyan, Mumbai and available for on-site roles across Mumbai, Thane, and Navi Mumbai. My resume is attached for your reference.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
];

const pdfBuffer = existsSync(PDF_PATH) ? readFileSync(PDF_PATH) : null;
let sent = 0, failed = 0;

for (const email of EMAILS) {
  console.log(`\n📧 Sending to ${email.company}...`);
  console.log(`   To: ${email.to}`);
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
