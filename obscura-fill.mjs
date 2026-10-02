#!/usr/bin/env node
/**
 * obscura-fill.mjs — Fill a Greenhouse job application via obscura fetch --eval
 * Uses file-based eval to avoid shell escaping issues
 */
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const JOB_URL = process.argv[2] || 'https://job-boards.eu.greenhouse.io/groww/jobs/4714061101#app';
const RESUME_PATH = process.argv[3] || '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';

const profile = {
  firstName: 'Jayesh',
  lastName: 'Singh',
  email: 'hsinghjayesh@gmail.com',
  phone: '+917821816193',
  location: 'Mumbai, Maharashtra, India',
  linkedin: 'https://linkedin.com/in/jayesh-singh',
  github: 'https://github.com/Jayesh-ux',
};

// Build the JS eval expression
const evalScript = `
(() => {
  const fill = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    return el.value === val;
  };

  const r = {};
  r.first_name = fill('first_name', '${profile.firstName}');
  r.last_name = fill('last_name', '${profile.lastName}');
  r.email = fill('email', '${profile.email}');
  r.phone = fill('phone', '${profile.phone}');
  r.location = fill('candidate-location', '${profile.location}');
  r.linkedin = fill('question_7783092101', '${profile.linkedin}');
  r.website = fill('question_7783093101', '${profile.github}');
  r.linkedin2 = fill('question_8252988101', '${profile.linkedin}');
  r.org = fill('question_8256074101', 'Qyuki Digital Media');
  r.role_desc = fill('question_8256081101', 'Full Stack Developer intern building production apps with React, Node.js, Spring Boot, PostgreSQL.');
  r.experience = fill('question_8256082101', '1');

  // Verify all values
  r._verify = {
    first_name: document.getElementById('first_name')?.value,
    last_name: document.getElementById('last_name')?.value,
    email: document.getElementById('email')?.value,
  };

  return JSON.stringify(r);
})()
`;

// Write eval script to temp file and run
const tmpFile = path.join(tmpdir(), 'obscura-eval.js');
writeFileSync(tmpFile, evalScript);

try {
  console.log('Fetching and filling:', JOB_URL);
  const result = execSync(
    `obscura fetch "${JOB_URL}" --stealth --timeout 30 --eval "$(cat ${tmpFile})" -q`,
    { encoding: 'utf-8', timeout: 45000 }
  );
  console.log('Fill result:', result.trim());
} catch (e) {
  console.error('Fill error:', e.message.slice(0, 200));
} finally {
  unlinkSync(tmpFile);
}
