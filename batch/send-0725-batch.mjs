#!/usr/bin/env node
import * as tls from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, '../output/cv-jayesh-generic.pdf');
const [, , USER_EMAIL, APP_PASSWORD] = process.argv;

if (!USER_EMAIL || !APP_PASSWORD) {
  console.log('Usage: node send-0725-batch.mjs <email> <app-password>');
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
        else if (step === 4 && line.startsWith('235 ')) { step = 5; process.stderr.write('  Auth OK\n'); sc(`MAIL FROM:<${USER_EMAIL}>`); }
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
    company: 'Inbotiq',
    num: '065',
    to: 'support@inbotiq.com',
    subject: 'Application for Full Stack Development Intern',
    body: `Dear Inbotiq Team,

I am writing to apply for the Full Stack Development Intern position. I am a Full Stack Developer with strong experience in React/TypeScript, Node.js, Python, and AI/ML integration — directly matching what you're looking for.

At FairPay Solution (fairpaysolution.com), I built and operate a live debt advisory platform serving 700+ clients, using Next.js, React, Supabase, and PostgreSQL. At Qyuki Digital Media / DeepSoch AI, I deployed and fine-tuned Llama 3.3 70B for US clients, built RAG pipelines, set up 96TB enterprise storage, and built custom RTX 3090 GPU compute nodes running at ~$60/month electricity cost.

Key highlights:
- Full-stack: React, Next.js, TypeScript, Node.js, Python, PostgreSQL, MongoDB
- AI/ML: LLM fine-tuning (Llama, Qwen, DeepSeek), RAG, n8n automation, model deployment
- Cloud/DevOps: AWS (EC2, Route 53, Lambda, S3), Vercel, CI/CD, Docker
- B.E. IT, University of Mumbai (2024)

I am based in Kalyan, Mumbai and available for WFH immediately. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,

  },
  {
    company: 'Metnmat Research',
    num: '066',
    to: 'contact@metnmat.com',
    subject: 'Application for Full Stack Development Intern',
    body: `Dear Metnmat Team,

I am writing to apply for the Full Stack Development Intern position in Mumbai. I am a Full Stack Developer with experience building production web applications using React, Next.js, Node.js, Python, and MongoDB.

At Rajlaxmi Solutions, I built SaaS products including GeoTrack (logistics tracking with PostGIS), recruitment platforms, and billing systems. I have experience integrating third-party APIs, building responsive dashboards, and working with AI/automation pipelines.

Key highlights:
- Full-stack: React, Next.js, Node.js, Python, MongoDB, PostgreSQL
- API integration: REST APIs, third-party services, payment gateways, WhatsApp Business
- Cloud: AWS (EC2, Route 53, S3), Vercel deployment
- B.E. IT, University of Mumbai (2024)

I am based in Kalyan, Mumbai and available for immediate on-site work. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,

  },
  {
    company: 'AREA REALTY',
    num: '067',
    to: 'info@area.net.in',
    subject: 'Application for Full Stack Development Intern',
    body: `Dear AREA REALTY Team,

I am writing to apply for the Full Stack Development Intern position in Navi Mumbai. I am a Full Stack Developer with experience building production web applications using React, Node.js, and databases.

I have built multiple full-stack SaaS products including FairPay Solution (700+ clients), GeoTrack (logistics), and recruitment platforms. I write clean, tested code and work comfortably with the terminal, APIs, and database design.

Key highlights:
- Full-stack: React, Node.js, Express, TypeScript, SQL databases
- API design and integration, REST, data flow between services
- Cloud deployment: AWS, Vercel, CI/CD pipelines
- B.E. IT, University of Mumbai (2024)

Navi Mumbai is easily commutable from Kalyan. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,

  },
  {
    company: 'EmendoAI',
    num: '068',
    to: 'contact@emendo.ai',
    subject: 'Application for Full Stack Development Intern',
    body: `Dear EmendoAI Team,

I am writing to apply for the Full Stack Development Intern position. I am a Full Stack Developer with hands-on experience in React/Next.js, TypeScript, Python, and AWS — matching your tech stack.

I have built and deployed production applications including FairPay Solution (Next.js/React/PostgreSQL, 700+ clients), GeoTrack (Node.js/PostGIS), and multiple SaaS platforms. At DeepSoch AI, I deployed Llama 3.3 70B and built AI infrastructure.

Key highlights:
- Frontend: React, Next.js, TypeScript, Tailwind CSS
- Backend: Node.js, Python, REST APIs, PostgreSQL, MongoDB
- Cloud: AWS (EC2, Route 53, Lambda, S3), Docker
- B.E. IT, University of Mumbai (2024)

Available for WFH including US shift timing. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,

  },
  {
    company: 'Daten & Wissen',
    num: '069',
    to: 'contact.us@datenwissen.com',
    subject: 'Application for Front End Development Intern',
    body: `Dear Daten & Wissen Team,

I am writing to apply for the Front End Development Intern position. I have strong experience building responsive web interfaces using React, Next.js, TypeScript, HTML, CSS, and Tailwind CSS.

I built the frontend for fairpaysolution.com (live platform, 700+ clients), GeoTrack logistics platform, and multiple SaaS products. I convert designs into pixel-perfect, responsive UIs and integrate them with backend APIs.

I am based in Kalyan — Bhayandar is commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,

  },
  {
    company: 'DP Info System',
    num: '070',
    to: 'info@dpinfosystem.in',
    subject: 'Application for Full Stack Development Intern',
    body: `Dear DP Info System Team,

I am writing to apply for the Full Stack Development Intern position. I am a Full Stack Developer with experience in React, Next.js, Node.js, PostgreSQL, and MySQL.

I have built production applications including FairPay Solution (Next.js/Supabase/PostgreSQL, 700+ clients) and GeoTrack (Node.js/PostGIS). I write clean, scalable code and follow software best practices.

Key highlights:
- Frontend: React, Next.js, JavaScript/TypeScript, Tailwind CSS
- Backend: Node.js, Express, REST APIs
- Databases: PostgreSQL, MySQL, MongoDB
- Tools: Git, CI/CD, AWS, Vercel
- B.E. IT, University of Mumbai (2024)

Available for WFH immediately. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,

  },
];

const pdfBuffer = existsSync(PDF_PATH) ? readFileSync(PDF_PATH) : null;
let sent = 0, failed = 0;

for (const email of EMAILS) {
  console.log(`\n📧 #${email.num} Sending to ${email.company}...`);
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
