#!/usr/bin/env node
const USER_EMAIL = 'hsinghjayesh@gmail.com';
const BASE = 'http://127.0.0.1:8787';

async function testApply(msg) {
  console.log('=== APPLY TEST ===');
  console.log('Message:', msg);
  console.log('');

  const resp = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': USER_EMAIL },
    body: JSON.stringify({ message: msg })
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let progressLog = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    let curEvent = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        curEvent = line.substring(7).trim();
      } else if (line.startsWith('data: ') && curEvent) {
        try {
          const d = JSON.parse(line.substring(6));
          if (curEvent === 'text_delta' && d.text) {
            fullText += d.text;
          }
          if (curEvent === 'progress') {
            progressLog.push({ t: d.elapsed, text: d.text, tool: d.currentTool });
          }
        } catch {}
        curEvent = null;
      }
    }
  }

  console.log('=== PROGRESS TIMELINE ===');
  for (const p of progressLog) {
    console.log(`  ${p.t}s: ${p.text}${p.tool ? ' [' + p.tool + ']' : ''}`);
  }
  console.log('');
  console.log('=== FULL RESPONSE ===');
  console.log(fullText);
  console.log('');
  console.log('=== STATS ===');
  console.log('Response length:', fullText.length, 'chars');
  console.log('Progress events:', progressLog.length);
}

const msg = process.argv[2] || 'apply to https://job-boards.greenhouse.io/gleanwork/jobs/4712442005';
testApply(msg).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
