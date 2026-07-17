#!/usr/bin/env node
import * as tls from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = resolve(__dirname, 'output/cv-jayesh-generic.pdf');
const [, , USER_EMAIL, APP_PASSWORD] = process.argv;

if (!USER_EMAIL || !APP_PASSWORD) {
  console.log('Usage: node send-new-batch.mjs <email> <app-password>');
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
        else if (step === 4 && line.startsWith('235 ')) { step = 5; process.stderr.write('  ✅ Authenticated\n'); sc(`MAIL FROM:<${USER_EMAIL}>`); }
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
    company: 'Metricoid Technology Solutions',
    to: 'hello@metricoidtech.com',
    subject: 'Application for AI Engineer Fresher',
    body: `Dear Hiring Team,

I am writing to apply for the AI Engineer Fresher position at Metricoid Technology Solutions. I am a Full Stack Developer with hands-on AI/ML experience including deploying Llama 3.3 70B for production US clients, building RAG pipelines, and fine-tuning models.

During my internship at DeepSoch AI, I deployed and managed a 96TB enterprise storage system with a custom RTX 3090 compute cluster running at ~$60/month electricity cost. At Qyuki Digital Media, I worked with LLMs, embeddings, and n8n automation pipelines.

Key highlights:
- Deployed Llama 3.3 70B model for US-based clients
- Built RAG pipelines and vector search implementations
- Fine-tuned AI models (Gemma Vision, Index TTS2)
- Full-stack development with React, Node.js, Python, PostgreSQL
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan, and Thane is easily commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'MITRA Fintech',
    to: 'career@mitrafintech.com',
    subject: 'Application for Full Stack Developer',
    body: `Dear Hiring Team,

I am writing to apply for opportunities at MITRA Fintech. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Deployed Llama 3.3 70B model and managed 96TB enterprise storage at DeepSoch AI
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and Malad West is commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Tax-O-Smart LLP',
    to: 'careers@taxosmart.com',
    subject: 'Application for ReactJS Development Intern',
    body: `Dear Hiring Team,

I am writing to apply for the ReactJS Development Intern position at Tax-O-Smart. I have strong hands-on experience with React.js, Next.js, JavaScript (ES6+), HTML/CSS, and REST API integration.

During my internship at Qyuki Digital Media, I built production web applications using React and Next.js. I have also developed fairpaysolution.com and Career Grid — full-stack applications with responsive UIs, state management, and API integration.

Key highlights:
- Built responsive UIs with React.js, Next.js, and TypeScript
- Integrated REST APIs and managed state with Redux/Context API
- Experience with Git/GitHub version control and CI/CD pipelines
- B.E. IT, Mumbai University (2024)

Based in Kalyan, Borivali West is commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Optimum Fintech',
    to: 'hr@optimumfintech.com',
    subject: 'Application for Software Developer',
    body: `Dear Hiring Team,

I am writing to apply for software developer opportunities at Optimum Fintech. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Experience with Angular, ASP.NET, and SQL Server from academic projects
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for on-site work in Mumbai. My resume is attached.

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
