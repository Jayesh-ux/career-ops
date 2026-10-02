#!/usr/bin/env node
// render-sample3.mjs — "portfolio-styled" sample using real CV facts.
import { bodyToHtml, mimeAlternative, attachmentPart, encodeMimeSubject } from './email-html.mjs';
import { writeFileSync } from 'fs';

const body = `Dear Hiring Team,

I build systems that ship — this email is my live preview. Same engineering: architecture to production.

Reasons to bring me onto your team:

- FairPay Solution (fairpaysolution.com) — built end to end, 700+ live clients, Razorpay + Google OAuth + RBAC
- GeoTrack — PostGIS proximity caching, ~40% cut in external map API costs
- OfferGhost / Hire2Onboard — hire-to-onboard automation, re-architected to multi-company
- Deployed and fine-tuned Llama 3.3 70B; stood up a 96TB enterprise storage array
- 27+ public repositories shipping frontend to backend to infrastructure

I operate across the whole stack — React/Next.js, Node.js, Django, Spring Boot, PostgreSQL — and I pick up your product, your stack, and your momentum fast.

Based in Kalyan (W), open to on-site or hybrid across Mumbai, Kalyan and Thane.

Best regards,
Jayesh Singh
+91-7821816193`;

const company = 'Geekay Infotech';
const html = bodyToHtml(body, company);
writeFileSync('/tmp/email-preview3.html', html, 'utf-8');
console.log('wrote /tmp/email-preview3.html bytes=' + Buffer.byteLength(html));

const { alt } = mimeAlternative(body, company);
const att = attachmentPart(Buffer.from('%PDF-1.4 mock'));
const mix = 'mix_' + Date.now();
const raw =
  `From: hsinghjayesh@gmail.com\r\n` +
  `To: hsinghjayesh@gmail.com\r\n` +
  `Subject: ${encodeMimeSubject('Portfolio-style application sample')}\r\n` +
  `MIME-Version: 1.0\r\n` +
  `Content-Type: multipart/mixed; boundary="${mix}"\r\n\r\n` +
  `--${mix}\r\n${alt}` +
  `--${mix}\r\n${att}` +
  `--${mix}--\r\n`;
writeFileSync('/tmp/sample3.raw.eml', raw, 'utf-8');
console.log('wrote /tmp/sample3.raw.eml bytes=' + Buffer.byteLength(raw));

import('mailparser').then(async ({ simpleParser }) => {
  const p = await simpleParser(raw);
  const h = p.html || '';
  const checks = {
    'decoded subject': p.subject === 'Portfolio-style application sample',
    'dark bg #0a0c0e': h.includes(INK_CHECK('#0a0c0e')),
    'teal accent': h.includes('00a0b8'),
    'brush 4-color strip': ['00a0b8', '4dd9e0', 'aeba27', 'f5cb01'].filter(c => h.includes(c)).length === 4,
    "hero 'Engineering systems that ship'": h.includes('Engineering systems'),
    'company badge': h.includes('APPLICATION') && h.includes('Geekay') || h.includes('APPLICATION &#8212; Geekay'),
    'stat chips (700+ / 96TB)': h.includes('700+') && h.includes('96TB'),
    'bullets as rows': (h.match(/width:20px;padding:0 8px 8px 0/g) || []).length > 0,
    'JS avatar': h.includes('>JS</span>'),
    'pill links (4)': ['mailto:hsinghjayesh@gmail.com', 'github.com/Jayesh-ux', 'linkedin.com/in/jayesh-dev', 'jayesh-ux.github.io/jayesh-singh'].filter(x => h.includes(x)).length === 4,
    'pdf attachment': p.attachments.some(a => a.contentType === 'application/pdf'),
  };
  for (const [k, v] of Object.entries(checks)) console.log((v ? 'PASS' : 'FAIL') + '  ' + k);
});
function INK_CHECK(c) { return c; }