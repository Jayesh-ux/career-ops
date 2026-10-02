#!/usr/bin/env node
/**
 * obscura-apply-with-resume.mjs — Apply to a single Greenhouse job with resume upload.
 * 
 * Approach: Each `obscura fetch --eval` is one-shot. To handle the async SPA submit,
 * we fill everything + upload resume via Object.defineProperty, then click submit,
 * then busy-wait in JS to keep the V8 context alive so the async fetch completes.
 *
 * Usage: node obscura-apply-with-resume.mjs <job_url>
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RESUME_PATH = process.env.RESUME_PATH || '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const RESUME_NAME = process.env.RESUME_NAME || 'Jayesh_Singh_Resume.pdf';

const P = {
  fn: 'Jayesh', ln: 'Singh', email: 'hsinghjayesh@gmail.com', phone: '+917821816193',
  linkedin: 'https://linkedin.com/in/jayesh-singh',
  github: 'https://github.com/Jayesh-ux',
  org: 'Qyuki Digital Media',
  roleDesc: 'Full Stack Developer intern building production apps with React, Node.js, Spring Boot, PostgreSQL.',
  experience: '1',
};

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' '); }

function readResumeB64() {
  return readFileSync(RESUME_PATH).toString('base64');
}

/**
 * Build the full JS eval that fills + uploads + submits + waits.
 */
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

  // Upload resume to #resume file input
  var fi = document.getElementById("resume");
  if (fi) {
    try {
      Object.defineProperty(fi, 'files', {value: [file], writable: true, configurable: true});
      fi.dispatchEvent(new Event('change', {bubbles: true}));
      r.resume = fi.files ? fi.files.length : -1;
    } catch(e) { r.resume = "ERR:" + e.message; }
  } else { r.resume = "no_input"; }

  // Click submit
  var btn = document.querySelector("button[type='submit']");
  if (!btn) {
    var bs = Array.from(document.querySelectorAll("button")).filter(function(b){return b.textContent.toLowerCase().indexOf("submit")>-1});
    if (bs.length) btn = bs[0];
  }
  if (btn) btn.click();
  r.submitted = !!btn;

  // Busy-wait to let async SPA submit complete
  var end = Date.now() + 10000;
  while (Date.now() < end) {}

  var body = document.body.innerText || "";
  r.bodyMarkers = (body.indexOf("Thank you")>-1 || body.indexOf("received your application")>-1) ? 1 : 0;

  return JSON.stringify(r);
})()`;
}

function applyToJob(url, resumeB64) {
  const evalExpr = buildEval(resumeB64);
  const tmpFile = `/tmp/obscura-apply-${Date.now()}.js`;
  writeFileSync(tmpFile, evalExpr);
  try {
    const out = execSync(
      `obscura fetch "${url}" --stealth --timeout 40 --eval "$(cat '${tmpFile}')" -q 2>&1`,
      { encoding: 'utf-8', timeout: 55000, maxBuffer: 512 * 1024 }
    ).trim();
    return out;
  } catch (e) {
    return (e.stdout?.toString?.()?.trim?.()) || 'TIMEOUT';
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

const url = process.argv[2];
if (!url) {
  console.error('Usage: node obscura-apply-with-resume.mjs <job_url>');
  process.exit(1);
}

console.log(`Applying to: ${url}`);
const resumeB64 = readResumeB64();
console.log(`Resume: ${RESUME_NAME} (${Math.round(resumeB64.length * 3 / 4 / 1024)}KB)`);

const result = applyToJob(url, resumeB64);
console.log(`Result: ${result}`);

try {
  const parsed = JSON.parse(result);
  const ok = parsed.resume >= 1 && parsed.submitted;
  console.log(`\n=== VERDICT ===`);
  console.log(`Fields filled: fn=${parsed.fn} ln=${parsed.ln} em=${parsed.em} ph=${parsed.ph}`);
  console.log(`Resume uploaded: ${parsed.resume}`);
  console.log(`Submit clicked: ${parsed.submitted}`);
  console.log(`Success: ${ok ? 'YES' : 'NO'}`);
} catch {
  console.log('\n(Unparseable output — check raw result above)');
}
