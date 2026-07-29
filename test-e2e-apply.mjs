import http from 'http';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-User-Id': 'hsinghjayesh@gmail.com',
  'X-Bridge-Token': '3c1434435017441c2e65f909924ca1aafd53bc3e926f7da9'
};

const JOB_URL = 'https://job-boards.greenhouse.io/vercel/jobs/5474915004';

let stepResults = {
  evaluate: false,
  draftEmail: false,
  draftShown: false,
  tracked: false
};

function post(path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: 8787, path, method: 'POST', headers: HEADERS }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    r.on('error', reject);
    r.write(JSON.stringify(body));
    r.end();
  });
}

function parseSSE(raw) {
  const events = [];
  const lines = raw.split('\n');
  let currentEvent = null;
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6);
      try {
        const parsed = JSON.parse(currentData);
        events.push({ event: currentEvent || 'message', data: parsed });
      } catch {
        events.push({ event: currentEvent || 'message', data: { raw: currentData } });
      }
      currentEvent = null;
      currentData = '';
    }
  }
  return events;
}

function checkStep(name, passed) {
  const icon = passed ? '✓' : '✗';
  const label = passed ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${label}: ${name}`);
  return passed;
}

async function main() {
  console.log('========================================');
  console.log('  E2E Apply Flow Test');
  console.log('  Job:', JOB_URL);
  console.log('  Time:', new Date().toISOString());
  console.log('========================================\n');

  const prompt = `Apply to this job: ${JOB_URL}

Do the full auto-pipeline:
1. Evaluate the job (A-G scoring)
2. Draft the application email
3. Show me the draft

DO NOT send the email — just draft it.`;

  console.log('[STEP 1] Sending request to bridge server...');
  let status, data;
  try {
    const res = await post('/chat/stream', { message: prompt });
    status = res.status;
    data = res.data;
  } catch (err) {
    console.log('  [✗] FAIL: Connection error —', err.message);
    printSummary();
    process.exit(1);
  }

  console.log(`  Response status: ${status}`);
  console.log(`  Response length: ${data.length} chars\n`);

  if (status !== 200) {
    console.log(`  [✗] FAIL: Expected status 200, got ${status}`);
    printSummary();
    process.exit(1);
  }

  console.log('[STEP 2] Parsing SSE events...');
  const events = parseSSE(data);
  console.log(`  Total events: ${events.length}\n`);

  console.log('[STEP 3] Analyzing events for step verification...\n');

  const allText = [];
  const allErrors = [];
  const toolEvents = [];
  const eventTypes = new Set();

  for (const ev of events) {
    eventTypes.add(ev.event);

    if ((ev.event === 'text' || ev.event === 'text_delta') && ev.data?.text) {
      allText.push(ev.data.text);
    }

    if (ev.event === 'error') {
      allErrors.push(ev.data?.error || ev.data?.message || JSON.stringify(ev.data));
    }

    if (ev.event === 'tool_start' || ev.event === 'tool_end') {
      toolEvents.push(ev);
    }
  }

  const fullText = allText.join('');

  console.log('  Event types seen:', [...eventTypes].join(', '));
  console.log('  Tool events:', toolEvents.length);
  console.log('  Text chunks:', allText.length);
  console.log('  Errors:', allErrors.length);

  if (allErrors.length > 0) {
    console.log('\n  Errors encountered:');
    for (const e of allErrors) {
      console.log('   -', e.slice(0, 300));
    }
  }

  console.log('\n--- Step Checks ---\n');

  const hasEval = /score|rating|strength|weakness|recommend|fit|evaluation|a-g/i.test(fullText);
  checkStep('Evaluate: Job evaluation present in response', hasEval);
  stepResults.evaluate = hasEval;

  const hasDraft = /dear|hiring|application|resume|position|role|interest/i.test(fullText);
  checkStep('Draft: Email draft present in response', hasDraft);
  stepResults.draftEmail = hasDraft;

  const hasShown = fullText.length > 200;
  checkStep('Show: Response contains substantial content', hasShown);
  stepResults.draftShown = hasShown;

  const hasTrack = /track|application|pipeline|added|recorded/i.test(fullText);
  checkStep('Track: Application tracking mentioned', hasTrack);
  stepResults.tracked = hasTrack;

  console.log('\n--- Response Preview (first 3000 chars) ---\n');
  console.log(fullText.slice(0, 3000));

  if (fullText.length > 3000) {
    console.log(`\n... (${fullText.length - 3000} more chars)`);
  }

  console.log('\n--- Full Event List ---\n');
  for (const ev of events) {
    const summary = ev.event === 'text'
      ? `"${ev.data?.text?.slice(0, 120) || ''}"`
      : ev.event === 'tool_start' || ev.event === 'tool_end'
        ? JSON.stringify(ev.data?.tool || ev.data?.name || '').slice(0, 80)
        : JSON.stringify(ev.data).slice(0, 120);
    console.log(`  [${ev.event}] ${summary}`);
  }

  printSummary();
}

function printSummary() {
  console.log('\n========================================');
  console.log('  TEST SUMMARY');
  console.log('========================================');
  const checks = [
    ['Evaluate job', stepResults.evaluate],
    ['Draft email', stepResults.draftEmail],
    ['Show draft to user', stepResults.draftShown],
    ['Track in applications', stepResults.tracked]
  ];
  let passed = 0;
  for (const [name, ok] of checks) {
    const icon = ok ? '✓' : '✗';
    console.log(`  [${icon}] ${name}`);
    if (ok) passed++;
  }
  console.log(`\n  Result: ${passed}/${checks.length} steps passed`);
  if (passed === checks.length) {
    console.log('  STATUS: ALL TESTS PASSED');
  } else {
    console.log('  STATUS: SOME TESTS FAILED');
  }
  console.log('========================================\n');
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
