// Check credentials status
const r = await fetch('http://127.0.0.1:8787/email/credentials');
const d = await r.json();
console.log(JSON.stringify(d, null, 2));
