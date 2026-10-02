#!/usr/bin/env node
/**
 * obscura-batch-greenhouse-resume.mjs — Apply with resume to all Greenhouse jobs.
 * Only processes Greenhouse URLs; skips others (they need different handling).
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_FILE = join(__dirname, 'data/pipeline.md');
const RESULTS_FILE = join(__dirname, 'data/greenhouse-resume-results.json');
const RESUME_PATH = '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const RESUME_NAME = 'Jayesh_Singh_Resume.pdf';

const P = {
  fn: 'Jayesh', ln: 'Singh', email: 'hsinghjayesh@gmail.com', phone: '+917821816193',
  linkedin: 'https://linkedin.com/in/jayesh-singh',
  github: 'https://github.com/Jayesh-ux',
  org: 'Qyuki Digital Media',
  roleDesc: 'Full Stack Developer intern building production apps with React, Node.js, Spring Boot, PostgreSQL.',
  experience: '1',
};

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' '); }

function parsePipeline() {
  const content = readFileSync(PIPELINE_FILE, 'utf-8');
  const jobs = [];
  for (const line of content.split('\n')) {
    const m = line.match(/- \[ \] (.+?) \| (.+?) \| (.+?) \| (.+?)(?:\s*\|\s*posted:\s*(.+))?$/);
    if (m) jobs.push({ url: m[1].trim(), company: m[2].trim(), role: m[3].trim(), location: m[4].trim() });
  }
  return jobs;
}

function buildEval(resumeB64) {
  return `(() => {
  var B64 = "${resumeB64}";
  var bin = atob(B64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var blob = new Blob([bytes], {type: "application/pdf"});
  var file = new File([blob], "${RESUME_NAME}", {type: "application/pdf"});

  var r = {};
  var s = function(id, v) {
    var e = document.getElementById(id);
    if (e) { e.value = v; e.dispatchEvent(new Event("input", {bubbles: true})); return true; }
    return false;
  };

  r.fn = s("first_name", "${esc(P.fn)}");
  r.ln = s("last_name", "${esc(P.ln)}");
  r.em = s("email", "${esc(P.email)}");
  r.ph = s("phone", "${esc(P.phone)}");
  s("candidate-location", "${esc(P.location || 'Mumbai, Maharashtra, India')}");
  s("question_7783092101", "${esc(P.linkedin)}");
  s("question_7783093101", "${esc(P.github)}");
  s("question_8252988101", "${esc(P.roleDesc)}");

  var fi = document.getElementById("resume");
  if (fi) {
    try {
      Object.defineProperty(fi, 'files', {value: [file], writable: true, configurable: true});
      fi.dispatchEvent(new Event('change', {bubbles: true}));
      r.resume = fi.files ? fi.files.length : -1;
      r.resumeName = fi.files && fi.files[0] ? fi.files[0].name : 'none';
    } catch(e) { r.resume = "ERR:" + e.message; }
  } else { r.resume = "no_input"; }

  var btn = document.querySelector("button[type='submit']");
  if (!btn) {
    var bs = Array.from(document.querySelectorAll("button")).filter(function(b){return b.textContent.toLowerCase().indexOf("submit")>-1});
    if (bs.length) btn = bs[0];
  }
  if (btn) btn.click();
  r.submitted = !!btn;

  var end = Date.now() + 10000;
  while (Date.now() < end) {}

  return JSON.stringify(r);
})()`;
}

function applyToJob(url, resumeB64) {
  const evalExpr = buildEval(resumeB64);
  const tmpFile = `/tmp/obscura-gh-${Date.now()}.js`;
  writeFileSync(tmpFile, evalExpr);
  try {
    return execSync(
      `obscura fetch "${url}" --stealth --timeout 40 --eval "$(cat '${tmpFile}')" -q 2>&1`,
      { encoding: 'utf-8', timeout: 60000, maxBuffer: 512 * 1024 }
    ).trim();
  } catch (e) {
    return (e.stdout?.toString?.()?.trim?.()) || 'TIMEOUT';
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function main() {
  const jobs = parsePipeline();
  const greenhouse = jobs.filter(j => j.url.includes('greenhouse.io'));

  let results = [];
  if (existsSync(RESULTS_FILE)) {
    try { results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8')); } catch {}
  }
  const doneUrls = new Set(results.map(r => r.url));
  const pending = greenhouse.filter(j => !doneUrls.has(j.url));

  console.log(`Greenhouse jobs: ${greenhouse.length} | Already done: ${results.length} | Pending: ${pending.length}`);

  const resumeB64 = readFileSync(RESUME_PATH).toString('base64');
  console.log(`Resume: ${RESUME_NAME} (${Math.round(resumeB64.length * 3 / 4 / 1024)}KB)\n`);

  let success = 0, fail = 0;
  for (let i = 0; i < pending.length; i++) {
    const job = pending[i];
    process.stdout.write(`[${i + 1}/${pending.length}] ${job.company} | ${job.role.slice(0, 35)} ... `);
    const out = applyToJob(job.url, resumeB64);
    let status = 'unknown';
    try {
      const p = JSON.parse(out);
      status = (p.resume >= 1 && p.submitted) ? 'submitted_with_resume' : 'incomplete';
      if (status === 'submitted_with_resume') success++; else fail++;
      console.log(status + ` (resume=${p.resume}, submit=${p.submitted})`);
    } catch {
      status = out.includes('no_form') || out.includes('no longer open') ? 'job_closed' : 'unparseable';
      fail++;
      console.log(status);
    }
    results.push({ url: job.url, company: job.company, role: job.role, status, ts: new Date().toISOString() });
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  }

  console.log(`\n===== DONE =====`);
  console.log(`Submitted with resume: ${success}`);
  console.log(`Failed: ${fail}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
