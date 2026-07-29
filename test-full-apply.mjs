#!/usr/bin/env node

/**
 * test-full-apply.mjs — Full apply flow test via chat/stream SSE
 * Tests: evaluation → email draft → email send → tracker entry
 */

const URL_TO_TEST = 'https://job-boards.greenhouse.io/gleanwork/jobs/4712442005';
const USER_EMAIL = 'hsinghjayesh@gmail.com';
const BASE = 'http://127.0.0.1:8787';

async function main() {
  console.log('=== FULL APPLY FLOW TEST ===');
  console.log('Job URL:', URL_TO_TEST);
  console.log('User:', USER_EMAIL);
  console.log('');

  const msg = 'apply to this job: ' + URL_TO_TEST;

  const resp = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': USER_EMAIL
    },
    body: JSON.stringify({ message: msg })
  });

  if (!resp.ok) {
    console.log('ERROR: HTTP', resp.status, await resp.text());
    process.exit(1);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let eventCount = 0;
  let progressEvents = [];
  let textChunks = [];
  let lastProgress = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    let currentEvent = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.substring(7).trim();
        eventCount++;
      } else if (line.startsWith('data: ') && currentEvent) {
        const dataStr = line.substring(6);
        try {
          const data = JSON.parse(dataStr);

          if (currentEvent === 'text_delta' && data.text) {
            fullText += data.text;
            textChunks.push(data.text);
            process.stdout.write(data.text);
          }

          if (currentEvent === 'progress') {
            lastProgress = data;
            progressEvents.push({
              elapsed: data.elapsed,
              step: data.step,
              currentTool: data.currentTool,
              text: data.text,
              portal: data.portal,
              phase: data.phase
            });
          }

          if (currentEvent === 'done') {
            console.log('\n');
            console.log('=== STREAM DONE ===');
          }
        } catch (e) {
          // not JSON
        }
        currentEvent = null;
      }
    }
  }

  console.log('');
  console.log('');
  console.log('=== TEST RESULTS ===');
  console.log('Total SSE events:', eventCount);
  console.log('Text chunks received:', textChunks.length);
  console.log('Total response length:', fullText.length, 'chars');
  console.log('Progress events:', progressEvents.length);
  console.log('');

  // Analyze what happened
  const hasEvaluation = fullText.includes('Score') || fullText.includes('score') || fullText.includes('Fit') || fullText.includes('Recommendation');
  const hasEmail = fullText.includes('email') || fullText.includes('Email') || fullText.includes('recruiter') || fullText.includes('send');
  const hasTracker = fullText.includes('tracker') || fullText.includes('Tracker') || fullText.includes('application');
  const hasApplyCard = fullText.includes('[Apply]') || fullText.includes('[Send]') || fullText.includes('[Draft]');
  const hasCompany = fullText.includes('Glean');

  console.log('Checks:');
  console.log('  Has company name (Glean):', hasCompany);
  console.log('  Has evaluation/score:', hasEvaluation);
  console.log('  Has email content:', hasEmail);
  console.log('  Has tracker mention:', hasTracker);
  console.log('  Has action card buttons:', hasApplyCard);
  console.log('');

  // Print progress timeline
  if (progressEvents.length > 0) {
    console.log('Progress timeline:');
    for (const p of progressEvents) {
      const parts = [`t=${p.elapsed}s`];
      if (p.step) parts.push(`step=${p.step}`);
      if (p.currentTool) parts.push(`tool=${p.currentTool}`);
      if (p.portal) parts.push(`portal=${p.portal}`);
      if (p.phase) parts.push(`phase=${p.phase}`);
      if (p.text) parts.push(`text="${p.text}"`);
      console.log('  ', parts.join(' | '));
    }
  }

  console.log('');
  console.log('=== FULL RESPONSE (last 2000 chars) ===');
  console.log(fullText.slice(-2000));
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
