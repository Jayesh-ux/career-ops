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
  console.log('=== Applying for MedSnap via spawned opencode ===');
  console.log('Time:', new Date().toISOString());
  
  const { status, data } = await post('/chat/stream', {
    message: 'Apply to MedSnap Full Stack Engineer: https://in.linkedin.com/jobs/view/full-stack-engineer-at-medsnap-4430690165 — do the full auto-pipeline: evaluate (A-G), draft application email, show me everything. DO NOT send the email — just draft it.'
  });
  
  console.log('Status:', status);
  console.log('Time:', new Date().toISOString());
  console.log('Response length:', data.length);
  console.log('\n=== FULL RESPONSE ===');
  console.log(data);
}

main().catch(e => console.error('Error:', e));
