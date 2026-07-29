const r = await fetch('http://127.0.0.1:8787/email/inbox?maxEmails=10&daysBack=30');
const d = await r.json();
console.log('Emails found:', d.emails?.length || 0);
for (const e of (d.emails || []).slice(0,15)) {
  console.log('---');
  console.log('From:', e.fromEmail || e.from);
  console.log('Subject:', e.subject);
  console.log('Date:', e.date);
  console.log('Preview:', (e.preview || '').substring(0, 120));
}
