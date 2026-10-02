#!/usr/bin/env node
/**
 * obscura-parallel-apply.mjs — Apply to remaining jobs in parallel batches
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';

const PIPELINE_FILE = '/root/career-ops/data/pipeline.md';
const RESULTS_FILE = '/root/career-ops/data/apply-results.json';

const P = {
  firstName: 'Jayesh', lastName: 'Singh', email: 'hsinghjayesh@gmail.com',
  phone: '+917821816193', location: 'Mumbai, Maharashtra, India',
  linkedin: 'https://linkedin.com/in/jayesh-singh', github: 'https://github.com/Jayesh-ux',
  org: 'Qyuki Digital Media',
  roleDesc: 'Full Stack Developer intern building production apps with React, Node.js, Spring Boot, PostgreSQL.',
  experience: '1',
};

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
  if (url.includes('boomi.com')) return 'skip_boomi';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('ashbyhq.com')) return 'ashby';
  if (url.includes('arbeitnow.com')) return 'arbeitnow';
  return 'unknown';
}

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' '); }

function obscuraEval(url, evalExpr, timeout = 20) {
  const tmpFile = `/tmp/oe-${Date.now()}-${Math.random().toString(36).slice(2,6)}.js`;
  writeFileSync(tmpFile, evalExpr);
  try {
    return execSync(
      `obscura fetch "${url}" --stealth --timeout ${timeout} --eval "$(cat '${tmpFile}')" -q 2>&1`,
      { encoding: 'utf-8', timeout: (timeout + 8) * 1000, maxBuffer: 512 * 1024 }
    ).trim();
  } catch (e) {
    return (e.stdout?.toString?.()?.trim?.()) || 'TIMEOUT';
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function greenhouseEval() {
  return `(() => {
  var f = document.getElementById("application-form");
  if (!f) return JSON.stringify({error:"no_form"});
  var s = function(id,v) { var e=f.querySelector("#"+id); if(e){e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return true;} return false; };
  var r = {};
  r.f = s("first_name","${esc(P.firstName)}");
  r.l = s("last_name","${esc(P.lastName)}");
  r.e = s("email","${esc(P.email)}");
  r.p = s("phone","${esc(P.phone)}");
  s("candidate-location","${esc(P.location)}");
  s("question_7783092101","${esc(P.linkedin)}");
  s("question_7783093101","${esc(P.github)}");
  s("question_8252988101","${esc(P.linkedin)}");
  s("question_8256074101","${esc(P.org)}");
  s("question_8256081101","${esc(P.roleDesc)}");
  s("question_8256082101","${esc(P.experience)}");
  var btn = f.querySelector("button[type='submit']");
  if (btn) btn.click();
  r.ok = !!btn;
  return JSON.stringify(r);
})()`;
}

function leverEval() {
  return `(() => {
  var s = function(sel,v) { var e=document.querySelector(sel); if(e){e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return true;} return false; };
  s('input[name="name"]',"${esc(P.firstName)} ${esc(P.lastName)}");
  s('input[name="email"]',"${esc(P.email)}");
  s('input[name="phone"]',"${esc(P.phone)}");
  s('input[name="org"]',"${esc(P.org)}");
  s('input[name="urls[LinkedIn]"]',"${esc(P.linkedin)}");
  var btn = document.querySelector('button[data-qa="btn-submit"]') || document.querySelector('.postings-btn-submit') || document.querySelector('button[type="submit"]');
  if(btn) btn.click();
  return JSON.stringify({clicked:!!btn, inputs:document.querySelectorAll("input").length});
})()`;
}

function processJob(job) {
  const portal = detectPortal(job.url);
  const result = { url: job.url, company: job.company, role: job.role, portal, ts: new Date().toISOString() };

  if (portal === 'skip_boomi') { result.status = 'skipped_boomi'; return result; }
  if (portal === 'unknown') { result.status = 'unsupported'; return result; }

  try {
    if (portal === 'greenhouse') {
      const r = obscuraEval(job.url, greenhouseEval(), 22);
      try { const p = JSON.parse(r); result.status = p.ok ? 'submitted' : 'fill_error'; result.fields = p; }
      catch { result.status = r.includes('no_form') ? 'no_form' : 'submitted_unparsed'; result.raw = r.slice(0, 100); }
    } else if (portal === 'lever') {
      const check = obscuraEval(job.url, 'document.querySelectorAll("input").length', 18);
      const inputs = parseInt(check) || 0;
      if (inputs > 2) {
        const r = obscuraEval(job.url, leverEval(), 22);
        try { const p = JSON.parse(r); result.status = p.clicked ? 'submitted' : 'partial'; }
        catch { result.status = 'submitted_unparsed'; }
      } else {
        result.status = inputs === 0 ? 'page_timeout' : 'too_few_inputs';
      }
    } else if (portal === 'ashby') {
      const r = obscuraEval(job.url, `Array.from(document.querySelectorAll("button")).filter(function(b){return b.textContent.toLowerCase().indexOf("apply")>-1})[0]?.click()||"no"`, 18);
      result.status = r.includes('no') ? 'no_apply_button' : 'apply_clicked';
    } else if (portal === 'arbeitnow') {
      const r = obscuraEval(job.url, `document.querySelector("form") ? "form_found" : "no_form"`, 18);
      if (r.includes('form_found')) {
        const fill = obscuraEval(job.url, `(() => {
          var s = function(sel,v) { var e=document.querySelector(sel); if(e){e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return true;} return false; };
          s('input[name="name"]',"${esc(P.firstName)} ${esc(P.lastName)}");
          s('input[name="email"]',"${esc(P.email)}");
          s('input[name="phone"]',"${esc(P.phone)}");
          var btn = document.querySelector('button[type="submit"]');
          if(btn) btn.click();
          return JSON.stringify({clicked:!!btn});
        })()`, 22);
        try { const p = JSON.parse(fill); result.status = p.clicked ? 'submitted' : 'partial'; }
        catch { result.status = 'submitted_unparsed'; }
      } else {
        result.status = 'no_form';
      }
    }
  } catch (e) {
    result.status = 'error';
    result.error = e.message?.slice(0, 100);
  }

  return result;
}

function worker(jobs, results, workerId) {
  return new Promise(async (resolve) => {
    for (const job of jobs) {
      const result = processJob(job);
      results.push(result);
      const sym = result.status === 'submitted' ? 'OK' : result.status === 'apply_clicked' ? 'CLICK' : 'FAIL';
      console.log(`[W${workerId}] ${sym} ${job.company.slice(0,12)}|${job.role.slice(0,30)} → ${result.status}`);
      writeFileSync(RESULTS_FILE, JSON.stringify({ results }, null, 2));
    }
    resolve();
  });
}

async function main() {
  const allJobs = parsePipeline();
  let existingResults = [];
  if (existsSync(RESULTS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
      existingResults = data.results || data;
    } catch {}
  }
  const doneUrls = new Set(existingResults.map(r => r.url));
  const pending = allJobs.filter(j => !doneUrls.has(j.url));

  console.log(`Remaining: ${pending.length} jobs (${existingResults.length} done)`);
  console.log(`Running 5 parallel workers...\n`);

  const BATCH_SIZE = 5;
  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  const allResults = [...existingResults];

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    console.log(`\n--- Batch ${bi + 1}/${batches.length} (${batch.length} jobs) ---`);
    const promises = batch.map((job, idx) => worker([job], allResults, idx + 1));
    await Promise.all(promises);
    writeFileSync(RESULTS_FILE, JSON.stringify({ results: allResults }, null, 2));
  }

  console.log(`\n========== FINAL RESULTS ==========`);
  const stats = {};
  for (const r of allResults) {
    const k = r.portal + ':' + r.status;
    stats[k] = (stats[k] || 0) + 1;
  }
  console.log(`Total processed: ${allResults.length}`);
  Object.entries(stats).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
