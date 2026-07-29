import http from 'http';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-User-Id': 'hsinghjayesh@gmail.com',
  'X-Bridge-Token': '3c1434435017441c2e65f909924ca1aafd53bc3e926f7da9'
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

async function main() {
  console.log('=== Sending apply message to opencode via chat/stream ===');
  
  const { status, data } = await post('/chat/stream', {
    message: 'apply to this job: https://in.linkedin.com/jobs/view/full-stack-engineer-at-medsnap-4430690165 — evaluate it, draft email, and send application. Show me everything.'
  });
  
  console.log('Status:', status);
  
  // Parse SSE events
  const lines = data.split('\n');
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      const evt = line.slice(7);
      console.log(`EVENT: ${evt}`);
    } else if (line.startsWith('data: ')) {
      try {
        const d = JSON.parse(line.slice(6));
        if (d.text) console.log('TEXT:', d.text.slice(0, 500));
        else if (d.error) console.log('ERROR:', d.error);
        else if (d.done) console.log('DONE');
        else console.log('DATA:', JSON.stringify(d).slice(0, 300));
      } catch {
        console.log('DATA:', line.slice(6).slice(0, 300));
      }
    }
  }
  
  console.log('\n=== Raw response (last 2000 chars) ===');
  console.log(data.slice(-2000));
}

main().catch(e => console.error('Error:', e));
