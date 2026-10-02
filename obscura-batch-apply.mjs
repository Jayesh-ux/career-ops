#!/usr/bin/env node
/**
 * obscura-batch-apply.mjs — Apply to all jobs via Obscura
 * Strategy: obscura fetch --eval fills form + submits in one shot
 * For Greenhouse: fills all text fields, clicks submit (React handler async)
 * For Lever/Ashby: detects form, fills, submits
 */
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';

const RESUME_PATH = '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const PIPELINE_FILE = '/root/career-ops/data/pipeline.md';
const RESULTS_FILE = '/root/career-ops/data/apply-results.json';
const DELAY_MS = 1500;

const P = {
  firstName: 'Jayesh',
  lastName: 'Singh',
  email: 'hsinghjayesh@gmail.com',
  phone: '+917821816193',
  location: 'Mumbai, Maharashtra, India',
  linkedin: 'https://linkedin.com/in/jayesh-singh',
  github: 'https://github.com/Jayesh-ux',
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
  if (url.includes('greenhouse.io') || url.includes('boomi.com')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('ashbyhq.com')) return 'ashby';
  if (url.includes('arbeitnow.com')) return 'arbeitnow';
  return 'unknown';
}

function obscuraEval(url, evalExpr, timeout = 30) {
  const tmpFile = `/tmp/oe-${Date.now()}-${Math.random().toString(36).slice(2,6)}.js`;
  writeFileSync(tmpFile, evalExpr);
  try {
    const result = execSync(
      `obscura fetch "${url}" --stealth --timeout ${timeout} --eval "$(cat '${tmpFile}')" -q 2>&1`,
      { encoding: 'utf-8', timeout: (timeout + 12) * 1000, maxBuffer: 512 * 1024 }
    );
    return result.trim();
  } catch (e) {
    const out = e.stdout?.toString?.()?.trim?.() || '';
    return out || 'TIMEOUT_OR_ERROR';
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function buildGreenhouseApply() {
  const p = P;
  return `
(() => {
  var f = document.getElementById("application-form");
  if (!f) return JSON.stringify({error:"no_form"});
  var s = (id,v) => { var e=f.querySelector("#"+id); if(e){e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return true;} return false; };
  var r = {};
  r.first = s("first_name","${esc(p.firstName)}");
  r.last = s("last_name","${esc(p.lastName)}");
  r.email = s("email","${esc(p.email)}");
  r.phone = s("phone","${esc(p.phone)}");
  r.loc = s("candidate-location","${esc(p.location)}");
  r.li = s("question_7783092101","${esc(p.linkedin)}");
  r.gh = s("question_7783093101","${esc(p.github)}");
  r.li2 = s("question_8252988101","${esc(p.linkedin)}");
  r.org = s("question_8256074101","${esc(p.org)}");
  r.desc = s("question_8256081101","${esc(p.roleDesc)}");
  r.exp = s("question_8256082101","${esc(p.experience)}");
  // Also try common Greenhouse fields for other jobs
  s("question_7783094101","${esc(p.linkedin)}");
  s("question_7783095101","${esc(p.github)}");
  s("question_8252987101","${esc(p.linkedin)}");
  // Click submit
  var btn = f.querySelector("button[type='submit']");
  if (btn) btn.click();
  r.submitted = !!btn;
  return JSON.stringify(r);
})()
`;
}

function buildLeverApply() {
  const p = P;
  return `
(() => {
  var s = (sel,v) => { var e=document.querySelector(sel); if(e){e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return true;} return false; };
  var r = {};
  r.name = s('input[name="name"]',"${esc(p.firstName)} ${esc(p.lastName)}");
  r.email = s('input[name="email"]',"${esc(p.email)}");
  r.phone = s('input[name="phone"]',"${esc(p.phone)}");
  r.org = s('input[name="org"]',"${esc(p.org)}");
  r.urls = s('input[name="urls[LinkedIn]"]',"${esc(p.linkedin)}");
  r.gh = s('input[name="urls[GitHub]"]',"${esc(p.github)}");
  // Lever forms use a different submit pattern
  var btn = document.querySelector('button[data-qa="btn-submit"]') || document.querySelector('.postings-btn-submit');
  if (btn) btn.click();
  r.submitted = !!btn;
  return JSON.stringify(r);
})()
`;
}

function buildAshbyApply() {
  const p = P;
  return `
(() => {
  var btn = Array.from(document.querySelectorAll("button")).filter(b=>b.textContent.toLowerCase().indexOf("apply")>-1)[0];
  if (btn) btn.click();
  return JSON.stringify({applyClicked: !!btn, title: document.title});
})()
`;
}

async function main() {
  const jobs = parsePipeline();
  console.log(`Pipeline: ${jobs.length} jobs`);

  let results = [];
  if (existsSync(RESULTS_FILE)) {
    try { results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8')); } catch {}
  }
  const doneUrls = new Set(results.map(r => r.url));
  const pending = jobs.filter(j => !doneUrls.has(j.url));
  console.log(`Pending: ${pending.length} (${doneUrls.size} already done)\n`);

  let stats = { greenhouse: { ok: 0, fail: 0 }, lever: { ok: 0, fail: 0 }, ashby: { ok: 0, fail: 0 }, arbeitnow: { ok: 0, fail: 0 }, other: 0 };

  for (let i = 0; i < pending.length; i++) {
    const job = pending[i];
    const portal = detectPortal(job.url);
    const result = { url: job.url, company: job.company, role: job.role, portal, status: 'pending', timestamp: new Date().toISOString() };

    process.stdout.write(`[${i + 1}/${pending.length}] ${job.company} | ${job.role.slice(0, 40)} (${portal}) ... `);

    try {
      if (portal === 'greenhouse') {
        // Step 1: Verify page loads
        const check = obscuraEval(job.url, 'document.getElementById("application-form") ? "FORM_OK" : "NO_FORM"', 20);
        if (check.includes('FORM_OK')) {
          // Step 2: Fill and submit
          const submitResult = obscuraEval(job.url, buildGreenhouseApply(), 30);
          try {
            const parsed = JSON.parse(submitResult);
            if (parsed.submitted) {
              result.status = 'submitted';
              result.fields = parsed;
              stats.greenhouse.ok++;
            } else {
              result.status = 'fill_only';
              result.fields = parsed;
              stats.greenhouse.fail++;
            }
          } catch {
            result.status = 'submitted_unparsed';
            result.raw = submitResult.slice(0, 200);
            stats.greenhouse.ok++;
          }
        } else if (check.includes('NO_FORM')) {
          result.status = 'no_form';
          stats.greenhouse.fail++;
        } else {
          result.status = 'page_load_failed';
          result.error = check.slice(0, 200);
          stats.greenhouse.fail++;
        }
      } else if (portal === 'ashby') {
        const clickResult = obscuraEval(job.url, buildAshbyApply(), 25);
        result.status = clickResult.includes('true') ? 'apply_clicked' : 'no_apply';
        result.raw = clickResult.slice(0, 200);
        stats.ashby[result.status === 'apply_clicked' ? 'ok' : 'fail']++;
      } else if (portal === 'lever') {
        // Lever needs longer timeout
        const check = obscuraEval(job.url, 'document.querySelectorAll("input").length + " inputs"', 25);
        if (check.match(/\d+ inputs/) && !check.includes('0 inputs')) {
          const submitResult = obscuraEval(job.url, buildLeverApply(), 30);
          result.status = submitResult.includes('"submitted":true') ? 'submitted' : 'partial';
          result.raw = submitResult.slice(0, 200);
          stats.lever[result.status === 'submitted' ? 'ok' : 'fail']++;
        } else {
          result.status = 'page_load_slow';
          stats.lever.fail++;
        }
      } else if (portal === 'arbeitnow') {
        const check = obscuraEval(job.url, 'document.querySelectorAll("form").length + " forms"', 20);
        result.status = check.includes('forms') ? 'detected' : 'page_load_failed';
        result.raw = check;
        stats.arbeitnow[check.includes('1 forms') ? 'ok' : 'fail']++;
      } else {
        result.status = 'unsupported';
        stats.other++;
      }
    } catch (e) {
      result.status = 'error';
      result.error = e.message?.slice(0, 200);
      if (stats[portal]) stats[portal].fail++;
      else stats.other++;
    }

    console.log(result.status);
    results.push(result);
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n========== RESULTS ==========`);
  console.log(`Greenhouse: ${stats.greenhouse.ok} submitted / ${stats.greenhouse.fail} failed`);
  console.log(`Lever:      ${stats.lever.ok} submitted / ${stats.lever.fail} failed`);
  console.log(`Ashby:      ${stats.ashby.ok} submitted / ${stats.ashby.fail} failed`);
  console.log(`Arbeitnow:  ${stats.arbeitnow.ok} submitted / ${stats.arbeitnow.fail} failed`);
  console.log(`Other:      ${stats.other}`);
  console.log(`Total:      ${results.length} processed`);

  writeFileSync(RESULTS_FILE, JSON.stringify({ stats, results }, null, 2));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
