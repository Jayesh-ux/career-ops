#!/usr/bin/env node
import * as tls from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, '..', 'output/cv-jayesh-generic.pdf');
const [, , USER_EMAIL, APP_PASSWORD] = process.argv;

if (!USER_EMAIL || !APP_PASSWORD) {
  console.log('Usage: node send-0714-batch-2.mjs <email> <app-password>');
  process.exit(1);
}

const HOST = 'smtp.gmail.com';
const PORT = 465;
const FROM_NAME = 'Jayesh Singh';

function smtpSend(to, subject, body, pdfBuffer) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(PORT, HOST, () => socket.setTimeout(15000));
    let step = 0, buffer = '', mailSent = false;

    const boundary = '==boundary_' + Date.now() + '==';
    let message = `From: ${FROM_NAME} <${USER_EMAIL}>\r\nTo: ${to}\r\n`;
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
        else if (step === 6 && line.startsWith('250 ')) { step = 8; sc('DATA'); }
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
    company: 'FynTune Solution',
    to: 'jobs@fyntune.com',
    subject: 'Application for ReactJS Development Internship',
    body: `Dear Hiring Team,

I am writing to apply for the ReactJS Development Internship at FynTune Solution. I have strong hands-on experience with React.js, Next.js, TypeScript, Node.js, and modern web development.

During my internship at DeepSoch AI and through my projects (Fair Pay Solution with 700+ clients, GeoTrack with PostGIS, OfferGhost recruitment pipeline), I have built production web applications end-to-end.

Key highlights:
- Built fairpaysolution.com with Next.js, React, Supabase, Razorpay payments, Google OAuth, and RBAC
- Deployed production apps with responsive UIs using Tailwind CSS and React
- Integrated REST APIs and managed state with React Context API
- Experience with Git/GitHub version control and cloud deployment on AWS/Vercel
- B.E. in Information Technology, University of Mumbai (2024)

I am based in Kalyan, and Navi Mumbai/Thane are easily commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,

  },
  {
    company: 'Heizen',
    to: 'hiring@heizen.work',
    subject: 'Application for Associate Software Engineer',
    body: `Dear Hiring Team,

I am writing to apply for the Associate Software Engineer position at Heizen. I am a Full Stack Developer with expertise in JavaScript, TypeScript, Python, React, Node.js, and PostgreSQL. I have built production-grade applications deployed on AWS and Vercel.

Key highlights:
- Built FairPay Solution (fairpaysolution.com) — fintech platform serving 700+ clients with Razorpay integration, Google OAuth, RBAC, ₹50Cr+ debt resolved
- Developed Career Grid — job portal with Spring Boot microservices, 2FA, AWS EC2/Route 53
- Built GeoTrack — real-time GPS tracking with PostGIS geospatial queries, ~40% API cost reduction
- Deployed Llama 3.3 70B model and managed 96TB enterprise storage infrastructure
- 27+ public repositories demonstrating consistent shipping
- B.E. IT, University of Mumbai (2024)

I am comfortable working remotely and have a reliable laptop setup with high-speed internet. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'SmartinfoLogiks / Analytics101',
    to: 'careers@smartinfologiks.com',
    subject: 'Application for Full Stack Developer - MERN',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Developer - MERN position at SmartinfoLogiks / Analytics101. I have strong hands-on experience with MongoDB, Express.js, React, Node.js, and PostgreSQL, along with production deployment on AWS.

Key highlights:
- Built FairPay Solution (fairpaysolution.com) — full-stack fintech platform with 700+ clients
- Developed Career Grid job portal with Spring Boot + React, 2FA, deployed on AWS
- Built GeoTrack with Node.js, PostGIS, real-time GPS tracking
- Experience with REST APIs, Git/GitHub, CI/CD, Docker basics
- Deployed applications on AWS EC2, Route 53, Vercel
- B.E. in Information Technology, University of Mumbai (2024)

I am based in Kalyan, and Navi Mumbai (CBD Belapur) is easily commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Flanknot - World Maritime Network',
    to: 'flanknot.mc@gmail.com',
    subject: 'Application for Laravel Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Laravel Developer position at Flanknot. I have experience with PHP, MySQL, HTML, CSS, JavaScript, Bootstrap, and Git — along with strong full-stack development skills.

During my internship at DeepSoch AI and through my project work, I've built and deployed production web applications. I am proficient in:
- PHP/MySQL backend development with REST APIs
- Frontend development with React, HTML, CSS, JavaScript, Bootstrap
- Version control with Git/GitHub
- Web application deployment on AWS

I am based in Kalyan, and Navi Mumbai is easily commutable. I'm eager to learn Laravel and contribute to building innovative solutions for the maritime industry. My resume is attached.

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
    await smtpSend(email.to, email.subject, email.body, pdfBuffer);
    console.log('✅ Sent!');
    sent++;
  } catch (err) {
    console.error(`❌ ${err.message}`);
    failed++;
  }
  await new Promise(r => setTimeout(r, 1000));
}

console.log(`\n=== Done: ${sent} sent, ${failed} failed ===`);
