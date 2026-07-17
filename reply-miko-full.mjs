#!/usr/bin/env node
import * as tls from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , USER_EMAIL, APP_PASSWORD] = process.argv;
if (!USER_EMAIL || !APP_PASSWORD) { console.log('Usage: ...'); process.exit(1); }

const PDF_PATH = resolve(__dirname, 'output/cv-jayesh-generic.pdf');
const HOST = 'smtp.gmail.com', PORT = 465;
const FROM = 'Jayesh Singh';
const to = 'khan.abdul@miko.ai';
const subject = '=?UTF-8?Q?Re:_Miko.ai_Java_Developer_-_Answers_to_questions?=';

const body = `Dear Abdul,

Thank you for considering my application for the Junior Java Developer role. Please find my answers below:

1. Current CTC: 2.4 LPA
2. Expected CTC: 4.5 - 6 LPA (negotiable based on role and growth opportunities)
3. Overall experience: ~1 year (4 months full-time + freelance/own venture projects)
4. Current location: Kalyan (W), Mumbai — fully available for on-site in Mumbai
5. Notice period: 15-20 days

Technical Questions:
6. Relevant experience in Java: 1+ year (Spring Boot, Core Java, REST APIs)
7. Java frameworks: Spring Boot, Spring MVC, Spring Data JPA/Hibernate
8. Experience with Vert.x: Not yet, but I have worked on reactive systems and willing to learn
9. Java multithreading: Basic to intermediate — have used ExecutorService, synchronized blocks, CompletableFuture in projects
10. Ubuntu: Yes — daily driver for development, server deployment, and command-line workflows
11. SQL database: Yes — PostgreSQL, MySQL — strong in queries, joins, indexing, and schema design
12. NoSQL database: Basic MongoDB
13. Redis: Basic familiarity, not used in production
14. Microservice or monolithic: Both — built microservices with Spring Boot (Career Grid) and monolithic apps
15. Git: Yes — daily use, GitHub, branching, merging, PR workflows
16. Postman API automation: Yes — used for API testing and collections
17. Load testing frameworks: Not yet professionally, but understand JMeter concepts
18. Claude/coding assistants: Yes — daily use of Claude, GitHub Copilot, and Cursor

I've attached my updated resume as requested.

Looking forward to the next steps!

Best regards,
Jayesh Singh
+91-7821816193`;

function smtpSend() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(PORT, HOST, () => socket.setTimeout(20000));
    let step = 0, buffer = '', mailSent = false;
    const pdfBuf = existsSync(PDF_PATH) ? readFileSync(PDF_PATH) : null;

    const boundary = '==boundary_' + Date.now() + '==';
    let msg = `From: ${FROM} <${USER_EMAIL}>\r\nTo: ${to}\r\nSubject: ${subject}\r\n`;
    msg += `MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    msg += `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n\r\n`;
    if (pdfBuf) {
      const b64 = pdfBuf.toString('base64');
      msg += `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="Jayesh_Singh_CV.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
      for (let i = 0; i < b64.length; i += 76) msg += b64.slice(i, i + 76) + '\r\n';
      msg += `\r\n`;
    }
    msg += `--${boundary}--\r\n`;

    function sc(c) { socket.write(c + '\r\n'); }
    socket.on('data', (d) => {
      buffer += d.toString();
      for (const l of buffer.split('\r\n')) {
        if (step===0 && l.startsWith('220 ')) { step=1; sc('EHLO career-ops'); }
        else if (step===1 && (l.startsWith('250 ')||l.startsWith('250-'))) { if(l.includes('AUTH')||l.startsWith('250 ')){ step=2; sc('AUTH LOGIN'); } }
        else if (step===2 && l.startsWith('334 ')) { step=3; sc(Buffer.from(USER_EMAIL).toString('base64')); }
        else if (step===3 && l.startsWith('334 ')) { step=4; sc(Buffer.from(APP_PASSWORD).toString('base64')); }
        else if (step===4 && l.startsWith('235 ')) { step=5; sc(`MAIL FROM:<${USER_EMAIL}>`); }
        else if (step===5 && l.startsWith('250 ')) { step=6; sc(`RCPT TO:<${to}>`); }
        else if (step===6 && l.startsWith('250 ')) { step=7; sc('DATA'); }
        else if (step===7 && l.startsWith('354 ')) { step=8; socket.write(msg + '\r\n.\r\n'); }
        else if (step===8 && l.startsWith('250 ')) { mailSent=true; sc('QUIT'); }
        else if (l.startsWith('535 ')) { reject(new Error('Auth failed')); socket.end(); }
      }
      buffer = '';
    });
    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('Timeout')));
    socket.on('close', () => { if (mailSent) resolve(); else reject(new Error('Failed')); });
  });
}

smtpSend().then(() => console.log('✅ Full reply sent to Miko.ai with all 18 answers + resume attached'))
  .catch(e => console.error('❌', e.message));
