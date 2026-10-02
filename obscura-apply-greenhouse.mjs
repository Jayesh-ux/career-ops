#!/usr/bin/env node
/**
 * obscura-apply-greenhouse.mjs — Full apply via Obscura
 * Fill form + upload resume + submit in a single fetch
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

const JOB_URL = process.argv[2] || 'https://job-boards.eu.greenhouse.io/groww/jobs/4714061101#app';
const RESUME_PATH = process.argv[3] || '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const DRY_RUN = process.argv.includes('--dry-run');

const resumeB64 = readFileSync(RESUME_PATH).toString('base64');

// Write eval JS to a temp file to avoid shell escaping issues
const evalJS = `
(() => {
  try {
    // Upload resume via DataTransfer
    var r = atob("${resumeB64}");
    var a = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i);
    var f = new File([a], "Jayesh_Singh_Resume.pdf", {type:"application/pdf"});
    var dt = new DataTransfer();
    dt.items.add(f);
    var inp = document.getElementById("resume");
    if (inp) { inp.files = dt.files; inp.dispatchEvent(new Event("change", {bubbles:true})); }

    // Fill text fields  
    var set = (id, val) => {
      var el = document.getElementById(id);
      if (!el) return false;
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    };

    set('first_name', 'Jayesh');
    set('last_name', 'Singh');
    set('email', 'hsinghjayesh@gmail.com');
    set('phone', '+917821816193');
    set('candidate-location', 'Mumbai, Maharashtra, India');
    set('question_7783092101', 'https://linkedin.com/in/jayesh-singh');
    set('question_7783093101', 'https://github.com/Jayesh-ux');
    set('question_8252988101', 'https://linkedin.com/in/jayesh-singh');
    set('question_8256074101', 'Qyuki Digital Media');
    set('question_8256081101', 'Full Stack Developer intern at Qyuki Digital Media. Built production apps with React, Node.js, Spring Boot, PostgreSQL.');
    set('question_8256082101', '1');

    // Verify
    var result = {
      resume: inp ? inp.files.length + ' file(s): ' + inp.files[0]?.name : 'NO INPUT',
      first_name: document.getElementById('first_name')?.value,
      last_name: document.getElementById('last_name')?.value,
      email: document.getElementById('email')?.value,
      submit: document.querySelector('button[type=submit]')?.textContent?.trim()
    };

    // Submit (unless dry run)
    ${DRY_RUN ? 'result.dryRun = true;' : 'document.querySelector("button[type=submit]")?.click(); result.submitted = true;'}

    return JSON.stringify(result);
  } catch(e) {
    return JSON.stringify({error: e.message});
  }
})()
`;

const evalFile = path.join(tmpdir(), 'obscura-eval.txt');
writeFileSync(evalFile, evalJS);

try {
  console.log('Obscura Apply —', DRY_RUN ? 'DRY RUN' : 'LIVE');
  console.log('Job:', JOB_URL);
  console.log('Resume:', RESUME_PATH, `(${(readFileSync(RESUME_PATH).length / 1024).toFixed(1)}KB)`);
  console.log('');

  const cmd = `obscura fetch "${JOB_URL}" --stealth --timeout 40 --eval "$(cat '${evalFile}')" -q`;
  const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
  const trimmed = result.trim();
  
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      console.log('Result:', JSON.stringify(parsed, null, 2));
    } catch {
      console.log('Raw output:', trimmed);
    }
  } else {
    console.log('No output — page may have navigated after submit');
    console.log(DRY_RUN ? 'Form was NOT submitted (dry run)' : 'Form was SUBMITTED');
  }
} catch (e) {
  console.error('Error:', e.message.slice(0, 300));
} finally {
  unlinkSync(evalFile);
}
