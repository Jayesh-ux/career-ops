#!/usr/bin/env node
/**
 * auto-apply-parallel.mjs — Headless auto-apply to ALL pipeline jobs with resume,
 * using the PROVEN Obscura V8 resume-upload + submit technique.
 *
 * Design (from what worked in obscura-parallel-apply.mjs):
 *  - Parallel workers, each writes its own result to the file AS IT COMPLETES
 *    (never wait for a whole chunk before persisting).
 *  - Concurrency limited; each worker is fully independent.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_FILE = join(__dirname, 'data/pipeline.md');
const RESULTS_FILE = join(__dirname, 'data/auto-apply-results.json');
const LOG_FILE = join(__dirname, 'data/auto-apply.log');
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

const FIELD_HINTS = [
  ['first_name', P.fn], ['firstname', P.fn], ['fname', P.fn],
  ['last_name', P.ln], ['lastname', P.ln], ['lname', P.ln],
  ['name', `${P.fn} ${P.ln}`],
  ['email', P.email], ['email_address', P.email],
  ['phone', P.phone], ['phone_number', P.phone], ['mobile', P.phone], ['telephone', P.phone],
  ['linkedin', P.linkedin], ['linkedin_url', P.linkedin],
  ['github', P.github], ['github_url', P.github],
  ['company', P.org], ['organization', P.org], ['current_company', P.org],
  ['location', `${P.city}, Maharashtra, India`], ['city', P.city],
  ['experience', P.experience], ['years_experience', P.experience],
];

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' '); }
function detectPortal(url) {
  if (url.includes('greenhouse.io')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('ashbyhq.com')) return 'ashby';
  if (url.includes('arbeitnow.com')) return 'arbeitnow';
  return 'other';
}

// Never embed raw base64 into shell strings (sed/split issues). Instead write the
// eval to a temp file and reference it via --eval "$(cat file)".
function buildEval() {
  const hintsJson = JSON.stringify(FIELD_HINTS);
  return `(() => {
  var HINTS = ${hintsJson};
  var NAME = "${RESUME_NAME}";
  var B64 = "__B64__";
  var r = { filled:0, uploadedFiles:[], fileInputs:0, submitted:false, title:document.title.slice(0,60) };
  try {
    var bin = atob(B64);
    var bytes = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    var blob = new Blob([bytes], {type:"application/pdf"});
    var file = new File([blob], NAME, {type:"application/pdf"});
  } catch(e){ return JSON.stringify({error:"blob_setup:"+e.message}); }
  function setVal(e,v){ e.value=v; e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); }
  var fields=Array.from(document.querySelectorAll("input,textarea,select"));
  fields.forEach(function(e){
    var t=(e.type||"").toLowerCase();
    if(t==="file"||t==="hidden"||t==="submit"||t==="button") return;
    var n=((e.id||"")+" "+(e.name||"")).toLowerCase();
    for(var i=0;i<HINTS.length;i++){var h=HINTS[i][0].toLowerCase(); if(n.indexOf(h)>-1){ setVal(e,HINTS[i][1]); r.filled++; break; }}
  });
  var fi=document.querySelector("input[type='file']");
  r.fileInputs=document.querySelectorAll("input[type='file']").length;
  if(fi){
    try{ Object.defineProperty(fi,'files',{value:[file],writable:true,configurable:true}); fi.dispatchEvent(new Event('change',{bubbles:true})); r.uploadedFiles.push(fi.files?fi.files.length:0); }catch(e){ r.uploadError=e.message; }
    if(!r.uploadedFiles.length||r.uploadedFiles[0]===0){ try{var dt=new DataTransfer();dt.items.add(file);fi.files=dt.files;r.uploadedFiles.push(fi.files?fi.files.length:0);}catch(e){} }
  }
  var btn=document.querySelector("button[type='submit']");
  if(!btn){ var bs=Array.from(document.querySelectorAll("button")).filter(function(b){var t=(b.textContent||"").toLowerCase();return t.indexOf("submit")>-1||t.indexOf("send application")>-1||t.indexOf("apply now")>-1;}); if(bs.length)btn=bs[bs.length-1]; }
  if(btn){ btn.click(); r.submitted=true; r.buttonText=(btn.textContent||"").trim().slice(0,30); }
  var end=Date.now()+8000; while(Date.now()<end){}
  return JSON.stringify(r);
})()`;
}

function tryJob(url, resumeB64) {
  const evalExpr = buildEval();
  const tmpFile = `/tmp/aap-eval-${Date.now()}-${Math.random().toString(36).slice(2,6)}.js`;
  // Safe base64 injection via Node (not sed): read template, replace marker, write
  const finalEval = evalExpr.replace('__B64__', resumeB64);
  writeFileSync(tmpFile, finalEval);
  try {
    return execSync(
      `obscura fetch "${url}" --stealth --timeout 28 --eval "$(cat '${tmpFile}')" -q 2>&1`,
      { encoding: 'utf-8', timeout: 45000, maxBuffer: 512 * 1024 }
    ).trim();
  } catch (e) {
    return (e.stdout?.toString?.()?.trim?.()) || 'TIMEOUT';
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function classify(out) {
  if (out === 'TIMEOUT' || out === '') return 'timeout_no_render';
  try {
    const p = JSON.parse(out);
    if (p.error) return 'eval_error';
    const uploaded = p.uploadedFiles.length && p.uploadedFiles[0] > 0;
    if (p.submitted && uploaded) return 'submitted_with_resume';
    if (p.submitted) return 'submitted_no_resume';
    if (p.fileInputs === 0) return 'no_file_input';
    return 'partial';
  } catch {
    if (out.includes('no longer open')) return 'job_closed';
    return 'unparseable';
  }
}

function log(msg) { writeFileSync(LOG_FILE, msg + '\n', { flag: 'a' }); }

function parsePipeline() {
  const content = readFileSync(PIPELINE_FILE, 'utf-8');
  const jobs = [];
  for (const line of content.split('\n')) {
    const m = line.match(/- \[ \] (.+?) \| (.+?) \| (.+?) \| (.+?)(?:\s*\|\s*posted:\s*(.+))?$/);
    if (m) jobs.push({ url: m[1].trim(), company: m[2].trim(), role: m[3].trim(), location: m[4].trim() });
  }
  return jobs;
}

async function main() {
  const jobs = parsePipeline();
  let results = [];
  if (existsSync(RESULTS_FILE)) {
    try {
      const d = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
      results = d.results || d;
    } catch { results = []; }
  }
  const done = new Set(results.map(r => r.url));
  const pending = jobs.filter(j => !done.has(j.url));
  const resumeB64 = readFileSync(RESUME_PATH).toString('base64');

  if (existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '');
  console.log(`AUTO-APPLY | resume=${RESUME_NAME} | pending=${pending.length}`);
  log(`AUTO-APPLY START | pending=${pending.length}`);

  const CONCURRENCY = 3;
  let idx = 0;
  async function worker() {
    while (idx < pending.length) {
      const job = pending[idx++];
      const out = tryJob(job.url, resumeB64);
      const status = classify(out);
      const portal = detectPortal(job.url);
      const rec = { url: job.url, company: job.company, role: job.role, portal, status, raw: out.slice(0,150), ts: new Date().toISOString() };
      results.push(rec);
      const sym = status === 'submitted_with_resume' ? 'OK ' : status === 'submitted_no_resume' ? 'OK*' : status === 'job_closed' ? 'CLS' : '-- ';
      const line = `${sym} ${job.company.slice(0,10)}|${job.role.slice(0,26)} (${portal}) -> ${status}`;
      console.log(line); log(line);
      writeFileSync(RESULTS_FILE, JSON.stringify({ results }, null, 2));
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const by = {};
  results.forEach(r => { const k = r.portal + ':' + r.status; by[k] = (by[k] || 0) + 1; });
  console.log(`\n===== DONE: ${results.length} =====`);
  Object.entries(by).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  writeFileSync(RESULTS_FILE, JSON.stringify({ summary: by, results }, null, 2));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
