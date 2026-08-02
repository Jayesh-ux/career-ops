#!/usr/bin/env node
/**
 * quick-apply.mjs — One-shot apply workflow
 *
 * Usage:
 *   node quick-apply.mjs <job-url> [--send]
 *
 * Flow:
 *   1. Generate guided-apply card (pre-filled fields from profile)
 *   2. Draft application email
 *   3. If --send, send via bridge server /email/send (requires user confirmation)
 *
 * Run from phone Termux where bridge server runs on 127.0.0.1:8787.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMOTE_PW = process.env.REMOTE_PLAYWRIGHT_URL || 'http://192.0.0.2:9998';
const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:8787';

const url = process.argv[2];
const shouldSend = process.argv.includes('--send');

if (!url) {
  console.log('Usage: node quick-apply.mjs <job-url> [--send]');
  process.exit(1);
}

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function loadProfile() {
  const p = join(__dirname, 'config', 'profile.yml');
  if (!existsSync(p)) return {};
  try {
    const content = readFileSync(p, 'utf-8');
    try { return JSON.parse(content); } catch {}
    const yaml = require('js-yaml');
    return yaml.load(content) || {};
  } catch { return {}; }
}

async function getGuide(jobUrl) {
  const resp = await fetch(`${REMOTE_PW}/playwright/guided-apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: jobUrl }),
    signal: AbortSignal.timeout(15000),
  });
  return resp.json();
}

function knownEmail(atsType) {
  const map = {
    Greenhouse: null,
    Lever: null,
    Workday: null,
    Ashby: null,
  };
  return map[atsType] || null;
}

function buildEmail(guide, profile) {
  const gf = guide.manual_apply_guide || {};
  const c = profile.candidate || {};
  const name = c.full_name || 'Candidate';
  const email = c.email || '';
  const phone = c.phone || '';
  const github = c.github || '';
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const domain = hostname.split('.').slice(-2).join('.');

  const headline = profile.narrative?.headline || 'Full Stack Developer';
  const proof = (profile.narrative?.proof_points || []).slice(0, 2).map(p =>
    `- ${p.name}: ${p.hero_metric}`
  ).join('\n');

  const to = knownEmail(guide.atsType) || `careers@${domain}`;

  return {
    to,
    subject: `Application for ${guide.atsType || 'Open'} Role — ${name}`,
    body: `Dear Hiring Team,

I am applying for the role listed at ${url}.

${headline}. I have built production platforms end-to-end:
${proof || '- Full-stack applications with React, Node.js, Python, and cloud deployment'}

My resume is attached. I welcome the opportunity to discuss how my experience aligns with your needs.

Best regards,
${name}
${email} | ${phone}
${github}`,
  };
}

async function main() {
  console.log('\n=== STEP 1: Generating guided-apply card ===\n');
  const guide = await getGuide(url);
  const gf = guide.manual_apply_guide || {};

  console.log(`Company: ${guide.atsType || 'Unknown'} | Confidence: ${gf.confidence}`);
  console.log(`URL: ${url}`);
  console.log(`Est. time: ${gf.estimated_fill_minutes} min`);
  console.log('\nPre-filled fields:');
  (gf.fields || []).forEach(f => console.log(`  ${f.field.padEnd(20)} ${f.value || '(fill in browser)'}`));

  if (gf.notes) console.log(`\nNotes: ${gf.notes}`);

  console.log('\n=== STEP 2: Application email draft ===\n');
  const profile = loadProfile();
  const email = buildEmail(guide, profile);

  console.log(`To: ${email.to}`);
  console.log(`Subject: ${email.subject}`);
  console.log(`\n${email.body}`);

  if (shouldSend) {
    console.log('\n=== STEP 3: Sending email ===\n');
    const sendResp = await fetch(`${BRIDGE}/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': profile.candidate?.email || '' },
      body: JSON.stringify({
        email: profile.candidate?.email || '',
        to: email.to,
        subject: email.subject,
        body: email.body,
        company: guide.atsType || 'Unknown',
        role: 'Open Application',
      }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await sendResp.json();
    console.log(result.success ? '✓ Email sent!' : `✗ Failed: ${result.error}`);
  } else {
    console.log('\n[DRAFT — Add --send to send via bridge server]');
  }
}

main().catch(e => console.error('Error:', e.message));
