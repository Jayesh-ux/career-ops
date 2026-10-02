#!/usr/bin/env node
/**
 * auto-apply-all.mjs — Headless auto-apply to every pipeline job with resume.
 *
 * Strategy per job:
 *  - Load page, detect <form> + inputs.
 *  - Fill every text/email/tel/textarea/select field by a robust generic
 *    strategy: match by name/id keywords, falling back to field type order.
 *  - Upload resume via Object.defineProperty(fileInput.files) — the ONLY
 *    proven resume-upload mechanism in Obscura V8 (DataTransfer is undefined).
 *  - Click submit button + busy-wait ~8s so async SPA POST completes.
 *  - Log outcome to data/auto-apply-results.json.
 *
 * Headless background: run with `setsid nohup node auto-apply-all.mjs &`
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_FILE = join(__dirname, 'data/pipeline.md');
const RESULTS_FILE = join(__dirname, 'data/auto-apply-results.json');
const RESUME_PATH = process.env.RESUME_PATH || '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const RESUME_NAME = 'Jayesh_Singh_Resume.pdf';

const P = {
  fn: 'Jayesh', ln: 'Singh', email: 'hsinghjayesh@gmail.com', phone: '+917821816193',
  linkedin: 'https://linkedin.com/in/jayesh-singh',
  github: 'https://github.com/Jayesh-ux',
  org: 'Qyuki Digital Media',
  roleDesc: 'Full Stack Developer intern building production apps with React, Node.js, Spring Boot, PostgreSQL.',
  experience: '1',
  city: 'Mumbai',
};

const FIELD_HINTS = {
  'first_name': v => P.fn, 'firstname': v => P.fn, 'fname': v => P.fn,
  'last_name': v => P.ln, 'lastname': v => P.ln, 'lname': v => P.ln,
  'name': v => `${P.fn} ${P.ln}`,
  'email': v => P.email, 'email_address': v => P.email, 'emailaddr': v => P.email,
  'phone': v => P.phone, 'phone_number': v => P.phone, 'mobile': v => P.phone, 'telephone': v => P.phone,
  'linkedin': v => P.linkedin, 'linkedin_url': v => P.linkedin, 'urls[linkedin]': v => P.linkedin,
  'github': v => P.github, 'github_url': v => P.github, 'urls[github]': v => P.github,
  'company': v => P.org, 'organization': v => P.org, 'current_company': v => P.org,
  'location': v => `${P.city}, Maharashtra, India`, 'city': v => P.city,
  'experience': v => P.experience, 'years_experience': v => P.experience,
  'resume': v => 'FILE', 'cv': v => 'FILE', 'attach_resume': v => 'FILE',
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

function detectPortal(url) {
  if (url.includes('greenhouse.io')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('ashbyhq.com')) return 'ashby';
  if (url.includes('arbeitnow.com')) return 'arbeitnow';
  return 'other';
}

// Build the generic fill+upload+submit eval. The JS receives the resume base64
// embedded at build time. It:
//   1) fills fields by name/id hint
//   2) uploads file to the FIRST <input type=file>
//   3) clicks the submit button
//   4) busy-waits for async submit
function buildEval(resumeB64) {
  const hints = JSON.stringify(FIELD_HINTS);
  return `(() => {
  var HINTS = ${hints};
  var B64 = "${resumeB64}";
  var RESUME_NAME = "${RESUME_NAME}";
  try {
    var bin = atob(B64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], {type: "application/pdf"});
    var file = new File([blob], RESUME_NAME, {type: "application/pdf"});
  } catch(e) { return JSON.stringify({error:"blob_setup:"+e.message}); }

  var r = { filled: 0, uploadedFiles: [], portal: document.title.slice(0,60) };

  function valFor(key) {
    var k = key.toLowerCase().replace(/[-_\\s]+/g, "_");
    if (HINTS[k] !== undefined) { var v = HINTS[k](); return v === "FILE" ? null : v; }
    // loose ends-with match
    for (var hk in HINTS) {
      if (k.indexOf(hk) > -1 || hk.indexOf(k) > -1) { var v2 = HINTS[hk](); return v2 === "FILE" ? null : v2; }
    }
    return null;
  }

  function setVal(e, v) {
    e.value = v;
    e.dispatchEvent(new Event("input", {bubbles: true}));
    e.dispatchEvent(new Event("change", {bubbles: true}));
  }

  // Fill text/email/tel/textarea/number fields
  var textFields = Array.from(document.querySelectorAll("input,textarea,select"));
  textFields.forEach(function(e){
    var t = (e.type || "").toLowerCase();
    if (t === "file" || t === "hidden" || t === "submit" || t === "button") return;
    var nameId = (e.id || "") + " " + (e.name || "");
    var val = valFor(nameId);
    if (val !== null && val !== undefined) {
      setVal(e, val); r.filled++;
    }
  });

  // Upload resume to first file input
  var fileInputs = Array.from(document.querySelectorAll("input[type='file']"));
  if (fileInputs.length) {
    try {
      Object.defineProperty(fileInputs[0], 'files', { value: [file], writable: true, configurable: true });
      fileInputs[0].dispatchEvent(new Event('change', {bubbles: true}));
      r.uploadedFiles.push(fileInputs[0].files ? fileInputs[0].files.length : 0);
    } catch(e) { r.uploadError = e.message; }
  }

  // Try data transfer as backup if file prop didn't register
  if (fileInputs.length && (!fileInputs[0].files || !fileInputs[0].files.length)) {
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      fileInputs[0].files = dt.files;
      r.uploadedFiles.push(fileInputs[0].files ? fileInputs[0].files.length : 0);
      fileInputs[0].dispatchEvent(new Event('change', {bubbles:true}));
    } catch(e) { r.dtError = "DataTransfer:" + e.message; }
  }

  // Click submit
  var btn = document.querySelector("button[type='submit']");
  if (!btn) {
    var bs = Array.from(document.querySelectorAll("button")).filter(function(b){
      var t=(b.textContent||"").toLowerCase();
      return t.indexOf("submit")>-1 || t.indexOf("apply")>-1 || t.indexOf("send")>-1 || t.indexOf("next")>-1;
    });
    if (bs.length) btn = bs[bs.length-1];
  }
  if (btn) { btn.click(); r.submitted = !!btn; r.buttonText = (btn.textContent||"").trim().slice(0,30); }

  // Busy-wait 8s for async submit
  var end = Date.now() + 8000;
  while (Date.now() < end) {}

  r.inputs = document.querySelectorAll("input,textarea,select").length;
  r.fileInputs = fileInputs.length;
  return JSON.stringify(r);
})()`;
}

function tryJob(url, resumeB64, timeout = 30) {
  const evalExpr = buildEval(resumeB64);
  const tmpFile = `/tmp/aa-${Date.now()}-${Math.random().toString(36).slice(2,6)}.js`;
  writeFileSync(tmpFile, evalExpr);
  try {
    return execSync(
      `obscura fetch "${url}" --stealth --timeout ${timeout} --eval "$(cat '${tmpFile}')" -q 2>&1`,
      { encoding: 'utf-8', timeout: (timeout + 15) * 1000, maxBuffer: 512 * 1024 }
    ).trim();
  } catch (e) {
    return (e.stdout?.toString?.()?.trim?.()) || 'TOTAL_TIMEOUT';
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function classify(out, portal) {
  if (out === 'TOTAL_TIMEOUT' || out === '') return 'timeout_or_empty';
  try {
    const p = JSON.parse(out);
    const uploaded = p.uploadedFiles && p.uploadedFiles.length && p.uploadedFiles[0] > 0;
    if (p.submitted && uploaded) return 'submitted_with_resume';
    if (p.submitted) return 'submitted_no_resume';
    if (p.uploadError || p.fileInputs === 0) return 'no_resume_input';
    return 'partial';
  } catch {
    return out.includes('no longer open') ? 'job_closed' : 'unparseable';
  }
}

async function main() {
  const jobs = parsePipeline();
  let results = [];
  if (existsSync(RESULTS_FILE)) {
    try { results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8')); } catch {}
  }
  const done = new Set(results.map(r => r.url));
  const pending = jobs.filter(j => !done.has(j.url));

  const resumeB64 = readFileSync(RESUME_PATH).toString('base64');
  console.log(`AUTO-APPLY-ALL | resume=${RESUME_NAME}(${Math.round(resumeB64.length*3/4/1024)}KB)`);
  console.log(`Pipeline jobs: ${jobs.length} | pending: ${pending.length}\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < pending.length; i++) {
    const job = pending[i];
    const portal = detectPortal(job.url);
    process.stdout.write(`[${i+1}/${pending.length}] ${job.company.slice(0,12)}|${job.role.slice(0,30)} (${portal}) ... `);
    const out = tryJob(job.url, resumeB64);
    const status = classify(out, portal);
    if (!status.startsWith('timeout') && !status.startsWith('unparseable') && !status.startsWith('job_closed') && status !== 'partial' && status !== 'no_resume_input') ok++; else fail++;
    console.log(status);
    results.push({ url: job.url, company: job.company, role: job.role, portal, status, raw: out.slice(0,180), ts: new Date().toISOString() });
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  }

  const by = {};
  results.forEach(r => { const k=r.portal+':'+r.status; by[k]=(by[k]||0)+1; });
  console.log(`\n===== DONE =====`);
  console.log(`Total in results: ${results.length}`);
  Object.entries(by).sort().forEach(([k,v]) => console.log(`  ${k}: ${v}`));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
