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
const PDF_PATH = resolve(__dirname, 'output/cv-jayesh-generic.pdf');

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
  {
    company: "Codes 'n' Coffee Tech.",
    to: 'hr@codesncoffee.com',
    subject: 'Application for Software Development Engineer - API',
    body: `Dear Hiring Team,

I am writing to apply for the Software Development Engineer - API position at Codes 'n' Coffee Tech. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA, and AWS EC2 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and Thane is easily commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Ingram Micro India',
    to: 'careersindia@ingrammicro.com',
    subject: 'Application for Software Engineer',
    body: `Dear Hiring Team,

I am writing to apply for the Software Engineer position at Ingram Micro India. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for on-site work in Mumbai. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Antarctica Global',
    to: 'contact@antarcticaglobal.com',
    subject: 'Application for Junior Fullstack Developer (Node/React)',
    body: `Dear Hiring Team,

I am writing to apply for the Junior Fullstack Developer (Node/React) position at Antarctica Global. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and the Mumbai office near CST is easily commutable. I am excited about Antarctica Global's mission-driven work in climate technology. Resume and cover letter attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Pluckk',
    to: 'careers@pluckk.in',
    subject: 'Application for Full Stack Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Developer position at Pluckk. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for on-site work in Mumbai. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'The Fast Way',
    to: 'hey@thefastway.in',
    subject: 'Application for Full Stack Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Developer position at The Fast Way. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for on-site work in Navi Mumbai. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Snabbit',
    to: 'careers@snabbit.in',
    subject: 'Application for SDE Full Stack',
    body: `Dear Hiring Team,

I am writing to apply for the SDE Full Stack position at Snabbit. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for on-site work in Mumbai. My resume is attached.

Best regards,
Jayesh Singh
    +91-7821816193`,
  },
  {
    company: 'The Red Arc',
    to: 'wecare@theredarc.com',
    subject: 'Application for Full Stack Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Developer position at The Red Arc. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for remote or on-site work in Mumbai. I am excited about The Red Arc's work in analytics and automation.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Scalix Enterprise Solution LLP',
    to: 'sales@scalix.in',
    subject: 'Application for Fresher Software Engineer',
    body: `Dear Hiring Team,

I am writing to apply for the Fresher Software Engineer position at Scalix Enterprise Solutions. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and Dahisar is easily commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Verdantis Technologies',
    to: 'careers@verdantis.com',
    subject: 'Application for Full Stack Developer Internship',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Developer Internship at Verdantis Technologies. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and Andheri East is easily commutable. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Cere Labs',
    to: 'contact@cerelabs.com',
    subject: 'Application for Software Developer Fresher',
    body: `Dear Hiring Team,

I am writing to apply for the Software Developer fresher position at Cere Labs. I am a Full Stack Developer experienced in React.js, Java, Python, Spring Boot, Node.js, and PostgreSQL.

During my internship at Qyuki Digital Media and through my projects (Fair Pay Solution, Career Grid), I delivered full-stack applications end-to-end.

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay, Google OAuth, RBAC
- Built Career Grid with Spring Boot microservices, 2FA, AWS
- Fine-tuned AI models, automated CI/CD via n8n
- B.E. IT, Mumbai University (2024)

Based in Kalyan, Mulund is easily commutable.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Systenics Solutions',
    to: 'jobs@systenics.com',
    subject: 'Application for Trainee Software Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Trainee Software Developer position at Systenics Solutions. I am a Full Stack Developer experienced in Java, Python, React.js, Node.js, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my projects (Fair Pay Solution, Career Grid), I delivered full-stack applications end-to-end.

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay, Google OAuth, RBAC
- Built Career Grid with Spring Boot microservices, 2FA, AWS
- Fine-tuned AI models, automated CI/CD via n8n
- B.E. IT, Mumbai University (2024)

Based in Kalyan, Sanpada Navi Mumbai is easily commutable.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Advin Softwares',
    to: 'info@advinsoftwares.com',
    subject: 'Application for Fresher Software Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Fresher Software Developer position at Advin Softwares. I am a Full Stack Developer experienced in Java, Python, React.js, Node.js, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my projects (Fair Pay Solution, Career Grid), I delivered full-stack applications end-to-end.

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay, Google OAuth, RBAC
- Built Career Grid with Spring Boot microservices, 2FA, AWS
- Fine-tuned AI models, automated CI/CD via n8n
- B.E. IT, Mumbai University (2024)

Based in Kalyan, CBD Belapur Navi Mumbai is easily commutable.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'LvlUp Labz',
    to: 'careers@lvluplabz.dev',
    subject: 'Application for Junior Full-Stack Developer',
    body: `Dear Hiring Team,

I am writing to apply for the Junior Full-Stack Developer position at LvlUp Labz. I am a Full Stack Developer with hands-on experience building production web applications using React.js, Next.js, Node.js, Express, TypeScript, PostgreSQL, and AWS.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS EC2/Route 53. I have worked with real-time features, WebSocket integrations, and CI/CD pipelines.

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated workflows via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan, Mumbai and available for on-site work. I am excited about building production-grade systems and contributing to real client projects from day one. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'SequelString AI',
    to: 'careers@sequelstring.com',
    subject: 'Application for AI/ML Intern',
    body: `Dear Hiring Team,

I am writing to apply for the AI/ML Intern position at SequelString AI. I have a strong foundation in Python, AI/ML concepts, and full-stack development with experience building AI-augmented applications.

During my internship at Qyuki Digital Media and through my projects, I have worked with:
- Python-based backend development and API integration
- AI model fine-tuning (Gemma Vision, Index TTS2)
- RAG pipelines, embeddings, and vector database concepts
- n8n automation workflows and CI/CD pipelines
- Full-stack development with React, Node.js, and PostgreSQL

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay, Google OAuth, RBAC
- Developed Career Grid with Spring Boot microservices, 2FA, AWS
- B.E. IT, Mumbai University (2024)

I am based in Kalyan and Mulund is easily commutable. I am passionate about AI and eager to build production-ready AI solutions.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'NeoSOFT Technologies',
    to: 'jobs@neosofttech.com',
    subject: 'Application for Software Engineer (Fresher)',
    body: `Dear Hiring Team,

I am writing to apply for the Software Engineer position at NeoSOFT Technologies. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built fairpaysolution.com with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for on-site work at your Dadar or Parel office. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Lofaz',
    to: 'info@lofaz.com',
    subject: 'Application for Full Stack Development Internship',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Development Internship at Lofaz. I have strong hands-on experience with React.js, Node.js, PostgreSQL, and MongoDB — technologies that align well with your tech stack.

During my internship at Qyuki Digital Media and through my projects (Fair Pay Solution, Career Grid), I delivered full-stack applications end-to-end with responsive UIs, REST APIs, and cloud deployment on AWS.

Key highlights:
- Built fairpaysolution.com with React/Next.js frontend and Supabase (PostgreSQL) backend
- Developed Career Grid with Spring Boot microservices, 2FA authentication, and AWS EC2 deployment
- Experience with Git, CI/CD, and collaborative development workflows
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan, Mumbai and available for on-site work. I am eager to contribute to building Lofaz's e-commerce platform.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'OLV Technologies',
    to: 'careers@olv.global',
    subject: 'Application for Full Stack Development Internship',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Development Internship at OLV Technologies. I have strong experience with Python, FastAPI, Angular, and full-stack development.

During my internship at Qyuki Digital Media and through my projects, I have built:
- Full-stack web applications using Python, React, and Node.js
- REST API integrations with secure authentication workflows
- Cloud-deployed applications on AWS with CI/CD pipelines

Key highlights:
- Built fairpaysolution.com with Google OAuth, Razorpay integration, and RBAC
- Developed Career Grid job portal with 2FA and AWS deployment
- Fine-tuned AI models and automated workflows via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for hybrid work in Mumbai. My resume is attached.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Pillow Tax',
    to: 'contact@pillowtax.com',
    subject: 'Application for Full Stack Development Internship',
    body: `Dear Hiring Team,

I am writing to apply for the Full Stack Development Internship at Pillow Tax. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, and PostgreSQL.

During my internship at Qyuki Digital Media and through my projects, I have built full-stack applications end-to-end including responsive UI development, API integrations, and database management.

Key highlights:
- Built fairpaysolution.com (fairpaysolution.com) — a full-stack loan settlement platform
- Developed Career Grid with Spring Boot microservices and AWS deployment
- Experience with HTML, CSS, JavaScript, and modern frontend frameworks
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan, Mumbai and available for full-time on-site work. I am excited about Pillow Tax's mission to simplify tax compliance through technology.

Best regards,
Jayesh Singh
+91-7821816193`,
  },
  {
    company: 'Metricoid Technology Solutions',
    to: 'hello@metricoidtech.com',
    subject: 'Application for AI Engineer Fresher',
    body: `Dear Hiring Team,

I am writing to apply for the AI Engineer Fresher position at Metricoid Technology Solutions. I am a Full Stack Developer with hands-on AI/ML experience including deploying Llama 3.3 70B for production US clients, building RAG pipelines, and fine-tuning models (Gemma Vision, Index TTS2).

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
  {
    company: 'Green Pista',
    to: 'hr@greenpista.com',
    subject: 'Application for Frontend Development Intern',
    body: `Dear Hiring Team,

I am writing to apply for the Frontend Development Intern position at Green Pista. I have strong hands-on experience with React.js, Next.js, JavaScript, HTML/CSS, and REST API integration.

During my internship at Qyuki Digital Media, I built production web applications using React and Next.js. I have also developed fairpaysolution.com and Career Grid — full-stack applications with responsive UIs, state management, and API integration.

Key highlights:
- Built responsive UIs with React.js and Next.js
- Integrated REST APIs and managed state with Redux/Context API
- Experience with Git/GitHub version control
- B.E. IT, Mumbai University (2024)

Based in Kalyan, Mumbai. Available for full-time on-site internship.

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
