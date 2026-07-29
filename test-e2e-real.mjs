#!/usr/bin/env node
import http from 'http';
import { readFileSync } from 'fs';

const EMAIL = 'hsinghjayesh@gmail.com';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-User-Id': EMAIL,
  'X-Bridge-Token': '3c1434435017441c2e65f909924ca1aafd53bc3e926f7da9'
};
const HOST = '127.0.0.1';
const PORT = 8787;
const TIMEOUT_MS = 5 * 60 * 1000;

function pickJobUrl() {
  try {
    const raw = readFileSync('data/pipeline.md', 'utf8');
    const urls = [...raw.matchAll(/- \[.\] (https?:\/\/\S+)/g)].map(m => m[1]);
    if (urls.length === 0) throw new Error('No URLs found');
    const idx = Math.floor(Math.random() * Math.min(urls.length, 50));
    return urls[idx];
  } catch (e) {
    console.log('  Could not read pipeline.md:', e.message);
    return 'https://www.amazon.jobs/en/jobs/10468973/software-engineer-i-discovery';
  }
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: HOST, port: PORT, path, method: 'GET', headers: HEADERS }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    r.on('error', reject);
    r.setTimeout(TIMEOUT_MS, () => { r.destroy(); reject(new Error('Request timed out')); });
    r.end();
  });
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: HOST, port: PORT, path, method: 'POST', headers: HEADERS }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    r.on('error', reject);
    r.setTimeout(TIMEOUT_MS, () => { r.destroy(); reject(new Error('Request timed out')); });
    r.write(JSON.stringify(body));
    r.end();
  });
}

function parseSSE(raw) {
  const events = [];
  let evt = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) {
      evt = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const payload = line.slice(6);
      try {
        events.push({ event: evt || 'message', data: JSON.parse(payload) });
      } catch {
        events.push({ event: evt || 'message', data: { raw: payload } });
      }
      evt = null;
    }
  }
  return events;
}

function check(label, passed) {
  console.log(`  ${passed ? '✓' : '✗'} ${label}`);
  return passed;
}

async function main() {
  console.log('========================================');
  console.log('  E2E Real Apply Flow Test');
  console.log('  Time:', new Date().toISOString());
  console.log('========================================\n');

  // ── Step 0: Check OAuth tokens ───────────────────────────────────
  console.log('[0/4] Checking OAuth tokens...');
  let tokenStatus, tokenBody;
  try {
    const res = await httpGet(`/users/${encodeURIComponent(EMAIL)}/oauth/tokens`);
    tokenStatus = res.status;
    tokenBody = JSON.parse(res.data);
  } catch (e) {
    console.log('  ✗ Connection error:', e.message);
    process.exit(1);
  }

  if (tokenStatus === 404) {
    console.log('\n  ✗ No OAuth tokens found for', EMAIL);
    console.log('\n  To set up OAuth tokens:');
    console.log('  1. Open the bridge server OAuth URL in a browser');
    console.log('  2. Complete Google consent flow');
    console.log('  3. Re-run this test\n');
    process.exit(1);
  }

  if (tokenStatus !== 200) {
    console.log(`  ✗ Unexpected status: ${tokenStatus}`);
    console.log('  Response:', tokenBody);
    process.exit(1);
  }

  const hasAccess = !!tokenBody.accessToken;
  const hasRefresh = !!tokenBody.refreshToken;
  check('OAuth access token present', hasAccess);
  check('OAuth refresh token present', hasRefresh);

  if (!hasAccess) {
    console.log('\n  ✗ Cannot proceed without access token. Re-authorize OAuth.\n');
    process.exit(1);
  }
  console.log(`  Token expires: ${tokenBody.expiresAt ? new Date(tokenBody.expiresAt).toISOString() : 'unknown'}`);
  console.log(`  Gmail scope: ${tokenBody.scope || 'unknown'}\n`);

  // ── Step 1: Pick a job ───────────────────────────────────────────
  const JOB_URL = pickJobUrl();
  console.log(`[1/4] Selected job: ${JOB_URL}\n`);

  // ── Step 2: Send apply message ───────────────────────────────────
  const prompt = `Apply to this job: ${JOB_URL}

Do the full auto-pipeline:
1. Evaluate the job (A-G scoring)
2. Draft the application email using my Gmail OAuth
3. Send the email
4. Track the application

This is a real test — go through all steps including sending.`;

  console.log('[2/4] Sending apply request to bridge server...');
  console.log('  (This may take several minutes)\n');

  let status, data;
  try {
    const res = await httpPost('/chat/stream', { message: prompt });
    status = res.status;
    data = res.data;
  } catch (e) {
    console.log('  ✗ Connection error:', e.message);
    printSummary({ connect: false });
    process.exit(1);
  }

  console.log(`  Response status: ${status}`);
  console.log(`  Response length: ${data.length} chars\n`);

  if (status !== 200) {
    console.log(`  ✗ Expected 200, got ${status}`);
    console.log('  Response:', data.slice(0, 500));
    printSummary({ connect: false });
    process.exit(1);
  }

  // ── Step 3: Parse and analyze ────────────────────────────────────
  console.log('[3/4] Parsing SSE events...');
  const events = parseSSE(data);
  console.log(`  Total events: ${events.length}\n`);

  const allText = [];
  const allErrors = [];
  const toolNames = [];
  const progressMessages = [];

  for (const ev of events) {
    if ((ev.event === 'text' || ev.event === 'text_delta') && ev.data?.text) allText.push(ev.data.text);
    if (ev.event === 'error') allErrors.push(ev.data?.error || ev.data?.message || JSON.stringify(ev.data));
    if (ev.event === 'tool_start') toolNames.push(ev.data?.tool?.name || ev.data?.name || '?');
    if (ev.event === 'tool_end') toolNames.push(`${ev.data?.tool?.name || ev.data?.name || '?'}(done)`);
    if (ev.event === 'progress' && ev.data?.text) progressMessages.push(ev.data.text);
  }

  const fullText = allText.join('');

  console.log('  Event types:', [...new Set(events.map(e => e.event))].join(', '));
  console.log('  Tools invoked:', toolNames.join(' → ') || 'none');
  console.log('  Text chunks:', allText.length);
  console.log('  Errors:', allErrors.length);

  console.log('\n--- Progress Messages (what user sees in app) ---');
  progressMessages.forEach((m, i) => console.log('  ' + (i+1) + '. ' + m));
  if (progressMessages.length === 0) console.log('  (none)');

  if (allErrors.length > 0) {
    console.log('\n  Errors:');
    for (const e of allErrors) console.log('   -', e.slice(0, 300));
  }

  // ── Step 4: Verify each flow step ────────────────────────────────
  console.log('\n[4/4] Step verification\n');

  const results = {};

  // Step A: Job evaluation
  results.evaluation = /score|rating|strength|weakness|recommend|fit|evaluation|a-g/i.test(fullText)
    && /(\d[\d.]*)\s*\/\s*5|strong|moderate|weak|poor/i.test(fullText);
  check('Job evaluation (score + fit assessment)', results.evaluation);

  // Step B: Email draft
  results.draft = /dear|hiring|application|resume|position|role|interest|subject|draft/i.test(fullText);
  check('Application email drafted', results.draft);

  // Step C: Email sent (look for send confirmation)
  results.sent = /sent|delivered|email.*sent|message.*sent|gmail.*sent|confirmed.*sent/i.test(fullText)
    && !(/do not send|draft only|DO NOT SEND/i.test(fullText) && !/sent.*successfully/i.test(fullText));
  check('Email sent via Gmail', results.sent);

  // Step D: Tracked
  results.tracked = /track|application.*added|pipeline|recorded|stored|saved/i.test(fullText);
  check('Application tracked in pipeline', results.tracked);

  // ── Output ───────────────────────────────────────────────────────
  console.log('\n--- Response Preview (first 4000 chars) ---\n');
  console.log(fullText.slice(0, 4000));
  if (fullText.length > 4000) console.log(`\n... (${fullText.length - 4000} more chars)`);

  if (toolNames.length > 0) {
    console.log('\n--- Tool Call Sequence ---');
    console.log('  ' + toolNames.join(' → '));
  }

  printSummary(results);
}

function printSummary(results) {
  console.log('\n========================================');
  console.log('  TEST RESULTS');
  console.log('========================================');

  const checks = [
    ['Job evaluation', results.evaluation],
    ['Email draft', results.draft],
    ['Email sent', results.sent],
    ['Application tracked', results.tracked]
  ];

  let passed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (ok) passed++;
  }

  console.log(`\n  ${passed}/${checks.length} steps passed`);
  console.log(passed === checks.length ? '  ALL TESTS PASSED' : '  SOME TESTS FAILED');
  console.log('========================================\n');
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
