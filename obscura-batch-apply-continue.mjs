#!/usr/bin/env node
/**
 * obscura-batch-apply-continue.mjs — Continue batch apply from where we left off
 * Optimized: shorter timeouts, skip known-bad URLs
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';

const PIPELINE_FILE = '/root/career-ops/data/pipeline.md';
const RESULTS_FILE = '/root/career-ops/data/apply-results.json';
const DELAY_MS = 1000;

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

function obscuraEval(url, evalExpr, timeout = 25) {
  const tmpFile = `/tmp/oe-${Date.now()}-${Math.random().toString(36).slice(2,6)}.js`;
  writeFileSync(tmpFile, evalExpr);
  try {
    return execSync(
      `obscura fetch "${url}" --stealth --timeout ${timeout} --eval "$(cat '${tmpFile}')" -q 2>&1`,
      { encoding: 'utf-8', timeout: (timeout + 10) * 1000, maxBuffer: 512 * 1024 }
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

async function main() {
  const jobs = parsePipeline();
  let results = [];
  if (existsSync(RESULTS_FILE)) {
    try { results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8')); } catch {}
  }
  const doneUrls = new Set(results.map(r => r.url));
  const pending = jobs.filter(j => !doneUrls.has(j.url));
  
  let submitted = 0, failed = 0, ashbyClicked = 0;
  const processed = results.length;

  console.log(`Resuming: ${pending.length} jobs remaining (${processed} done)\n`);

  for (let i = 0; i < pending.length; i++) {
    const job = pending[i];
    const portal = detectPortal(job.url);
    const result = { url: job.url, company: job.company, role: job.role, portal, ts: new Date().toISOString() };

    if (portal === 'skip_boomi') {
      result.status = 'skipped_boomi_timeout';
      console.log(`[${i+1}/${pending.length}] SKIP Boomi: ${job.role.slice(0,40)}`);
      results.push(result);
      failed++;
      writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
      continue;
    }

    process.stdout.write(`[${i+1}/${pending.length}] ${job.company.slice(0,12)} | ${job.role.slice(0,35)} (${portal}) ... `);

    try {
      if (portal === 'greenhouse') {
        const r = obscuraEval(job.url, greenhouseEval(), 25);
        try {
          const p = JSON.parse(r);
          result.status = p.ok ? 'submitted' : 'fill_error';
          result.fields = p;
          if (p.ok) submitted++; else failed++;
        } catch {
          result.status = 'submitted_unparsed';
          result.raw = r.slice(0, 150);
          submitted++;
        }
      } else if (portal === 'ashby') {
        const r = obscuraEval(job.url, `Array.from(document.querySelectorAll("button")).filter(function(b){return b.textContent.toLowerCase().indexOf("apply")>-1})[0]?.click() || "no_btn"`, 20);
        result.status = r.includes('no_btn') ? 'no_apply_button' : 'apply_clicked';
        if (result.status === 'apply_clicked') ashbyClicked++; else failed++;
        result.raw = r.slice(0, 100);
      } else if (portal === 'lever') {
        const r = obscuraEval(job.url, `document.querySelectorAll("input").length + "|" + document.title`, 20);
        const inputs = parseInt(r.split('|')[0]) || 0;
        if (inputs > 2) {
          // Fill lever form
          const fillR = obscuraEval(job.url, `(() => {
            var s = function(sel,v) { var e=document.querySelector(sel); if(e){e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return true;} return false; };
            s('input[name="name"]',"${esc(P.firstName)} ${esc(P.lastName)}");
            s('input[name="email"]',"${esc(P.email)}");
            s('input[name="phone"]',"${esc(P.phone)}");
            s('input[name="org"]',"${esc(P.org)}");
            s('input[name="urls[LinkedIn]"]',"${esc(P.linkedin)}");
            var btn = document.querySelector('button[data-qa="btn-submit"]') || document.querySelector('.postings-btn-submit') || document.querySelector('button[type="submit"]');
            if(btn) btn.click();
            return JSON.stringify({clicked:!!btn, inputs:document.querySelectorAll("input").length});
          })()`, 25);
          result.status = fillR.includes('"clicked":true') ? 'submitted' : 'partial';
          if (result.status === 'submitted') submitted++; else failed++;
          result.raw = fillR.slice(0, 150);
        } else {
          result.status = 'page_load_slow';
          failed++;
        }
      } else if (portal === 'arbeitnow') {
        const r = obscuraEval(job.url, `document.querySelectorAll("form").length + "|" + document.title`, 20);
        result.status = r.startsWith('1|') ? 'form_found' : 'no_form';
        result.raw = r.slice(0, 100);
        failed++;
      } else {
        result.status = 'unsupported';
        failed++;
      }
    } catch (e) {
      result.status = 'error';
      result.error = e.message?.slice(0, 100);
      failed++;
    }

    console.log(result.status);
    results.push(result);
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n========== FINAL RESULTS ==========`);
  console.log(`Total processed: ${results.length}`);
  console.log(`Greenhouse submitted: ${submitted}`);
  console.log(`Ashby apply clicked: ${ashbyClicked}`);
  console.log(`Failed/Other: ${failed}`);
  
  const portalStats = {};
  for (const r of results) {
    const k = r.portal;
    if (!portalStats[k]) portalStats[k] = {};
    portalStats[k][r.status] = (portalStats[k][r.status] || 0) + 1;
  }
  console.log('\nPer-portal breakdown:');
  for (const [portal, statuses] of Object.entries(portalStats)) {
    console.log(`  ${portal}:`, Object.entries(statuses).map(([s,c]) => `${s}(${c})`).join(', '));
  }

  writeFileSync(RESULTS_FILE, JSON.stringify({ summary: portalStats, results }, null, 2));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
