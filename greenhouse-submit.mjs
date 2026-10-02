#!/usr/bin/env node
/**
 * greenhouse-submit.mjs — Submit Greenhouse application with resume via HTTP
 * Key insight: job_application must be sent as JSON with resume as base64 inside it
 */
import { readFileSync } from 'fs';

const RESUME_PATH = '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const resumeBuf = readFileSync(RESUME_PATH);
const resumeB64 = resumeBuf.toString('base64');
const BOUNDARY = '----FB' + Math.random().toString(36).slice(2);

const jobApp = JSON.stringify({
  first_name: 'Jayesh',
  last_name: 'Singh',
  email: 'hsinghjayesh@gmail.com',
  phone: '+917821816193',
  candidate_location: 'Mumbai, Maharashtra, India',
  question_7783092101: 'https://linkedin.com/in/jayesh-singh',
  question_7783093101: 'https://github.com/Jayesh-ux',
  question_8252988101: 'https://linkedin.com/in/jayesh-singh',
  question_8256074101: 'Qyuki Digital Media',
  question_8256081101: 'Full Stack Developer intern at Qyuki Digital Media. Built production apps with React, Node.js, Spring Boot, PostgreSQL.',
  question_8256082101: '1',
});

// Build multipart body manually
let body = `--${BOUNDARY}\r\n`;
body += `Content-Disposition: form-data; name="job_application"\r\n\r\n`;
body += `${jobApp}\r\n`;

const bodyStart = Buffer.from(body, 'utf-8');
const fileHeader = Buffer.from(
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="job_application[resume]"; filename="Jayesh_Singh_Resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
);
const fileFooter = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
const fullBody = Buffer.concat([bodyStart, fileHeader, resumeBuf, fileFooter]);

const url = 'https://boards.eu.greenhouse.io/groww/jobs/4714061101';
console.log('Submitting to:', url);
console.log('Resume:', (resumeBuf.length / 1024).toFixed(1), 'KB');

try {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      'Origin': 'https://job-boards.eu.greenhouse.io',
      'Referer': 'https://job-boards.eu.greenhouse.io/groww/jobs/4714061101',
    },
    body: fullBody,
    redirect: 'follow',
  });

  console.log('Final Status:', resp.status);
  console.log('Final URL:', resp.url);

  const text = await resp.text();

  if (text.includes('Thank you') || text.includes('has been received') || text.includes('confirmation')) {
    console.log('\n*** APPLICATION SUBMITTED SUCCESSFULLY ***');
  } else if (text.includes('error')) {
    console.log('\n*** ERROR ***');
    const errors = text.match(/class="error[^"]*"[^>]*>[^<]*/g);
    if (errors) errors.forEach(e => console.log(' ', e));
  } else {
    console.log('\nResponse excerpt:', text.slice(0, 500));
  }
} catch (e) {
  console.log('Error:', e.message);
}
