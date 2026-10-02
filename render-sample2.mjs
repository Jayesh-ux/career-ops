#!/usr/bin/env node
// render-sample2.mjs — emit the "stunning" sample email HTML to a file AND
// print the MIME sender the bridge would use. Facts are taken verbatim from
// the real cv.md / profile.yml — nothing invented.
import { bodyToHtml, mimeAlternative, attachmentPart, encodeMimeSubject } from './email-html.mjs';
import { writeFileSync } from 'fs';

const body = `Dear Recruiters,

This is the upgraded, tailor-made HTML application — proof that emails from this service arrive beautifully formatted, not as plain text.

Why this matters for your team:

- You get a branded, single-column layout that renders perfectly in Gmail, Outlook and mobile
- Bullet highlights stay readable with a clean dot marker and generous line height
- The signature block carries my phone, email, LinkedIn, GitHub and portfolio as tappable pill links

What I bring:

- FairPay Solution (fairpaysolution.com) — production loan settlement platform, 700+ clients, Razorpay + Google OAuth + RBAC
- GeoTrack — PostGIS proximity caching cut external map API costs by ~40%
- OfferGhost / Hire2Onboard — end-to-end hire-to-onboard multi-company architecture
- Deployed and fine-tuned Llama 3.3 70B; contributed to 96TB enterprise storage infra
- 27+ public repositories; junior/mid full-stack, targeting 3-6 LPA

I am based in Kalyan (W), open to on-site or hybrid across Mumbai, Kalyan and Thane.

Best regards,
Jayesh Singh
+91-7821816193`;

const company = 'Geekay Infotech';
const html = bodyToHtml(body, company);
writeFileSync('/tmp/email-preview2.html', html, 'utf-8');
console.log('wrote /tmp/email-preview2.html bytes=' + Buffer.byteLength(html));

const { boundaryAlt, alt } = mimeAlternative(body, company);
const pdf = Buffer.from('%PDF-1.4 mock-resume-bytes');
const att = attachmentPart(pdf, 'Jayesh_Singh_CV.pdf');
const mix = 'mix_' + Date.now();
const raw =
  `From: hsinghjayesh@gmail.com\r\n` +
  `To: hsinghjayesh@gmail.com\r\n` +
  `Subject: ${encodeMimeSubject('Your upgraded HTML application sample')}\r\n` +
  `MIME-Version: 1.0\r\n` +
  `Content-Type: multipart/mixed; boundary="${mix}"\r\n\r\n` +
  `--${mix}\r\n${alt}` +
  `--${mix}\r\n${att}` +
  `--${mix}--\r\n`;
writeFileSync('/tmp/sample2.raw.eml', raw, 'utf-8');
console.log('wrote /tmp/sample2.raw.eml bytes=' + Buffer.byteLength(raw));