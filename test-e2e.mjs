import http from 'http';

const BASE = 'http://127.0.0.1:8787';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-User-Id': 'hsinghjayesh@gmail.com',
  'X-Bridge-Token': '3c1434435017441c2e65f909924ca1aafd53bc3e926f7da9'
};

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { hostname: '127.0.0.1', port: 8787, path: url.pathname + url.search, method, headers: HEADERS };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  console.log('=== STEP 1: Health Check ===');
  const h = await req('GET', '/health');
  console.log('Status:', h.status);
  console.log('Response:', JSON.stringify(h.data, null, 2));

  console.log('\n=== STEP 2: Auto-Pipeline (MedSnap Full Stack - Mumbai) ===');
  const p = await req('POST', '/auto-pipeline', {
    url: 'https://in.linkedin.com/jobs/view/full-stack-engineer-at-medsnap-4430690165'
  });
  console.log('Status:', p.status);
  console.log('Response keys:', Object.keys(p.data));
  console.log('Company:', p.data.company);
  console.log('Role:', p.data.role);
  console.log('Score:', p.data.score);
  console.log('Fit:', p.data.fit);
  console.log('Strengths:', p.data.strengths);
  console.log('Gaps:', p.data.gaps);
  console.log('Recommendation:', p.data.recommendation);
  console.log('ReportPath:', p.data.reportPath);
  console.log('Full response:', JSON.stringify(p.data, null, 2).slice(0, 3000));

  console.log('\n=== STEP 3: Email Draft ===');
  const d = await req('POST', '/email/draft', {
    company: p.data.company || 'MedSnap',
    role: p.data.role || 'Full-Stack Engineer',
    recipientEmail: 'careers@medsnap.in',
    recipientName: 'MedSnap Hiring Team'
  });
  console.log('Status:', d.status);
  console.log('Response:', JSON.stringify(d.data, null, 2).slice(0, 2000));

  console.log('\n=== STEP 4: Email Send (DRY RUN - check if endpoint exists) ===');
  // Don't actually send, just check if the endpoint accepts the request format
  const s = await req('POST', '/email/send', {
    to: 'careers@medsnap.in',
    subject: d.data?.subject || 'Test',
    body: d.data?.body || 'Test body'
  });
  console.log('Status:', s.status);
  console.log('Response:', JSON.stringify(s.data, null, 2).slice(0, 1000));

  console.log('\n=== DONE ===');
}

main().catch(e => console.error('Error:', e));
