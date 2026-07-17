#!/usr/bin/env node
import * as tls from 'tls';
const [, , USER, PASS] = process.argv;
if (!USER || !PASS) { console.log('Usage: node reply-1accord.mjs <email> <pass>'); process.exit(1); }

const socket = tls.connect(465, 'smtp.gmail.com', () => socket.setTimeout(15000));
let step = 0, buf = '', sent = false;
const msg = 'From: Jayesh Singh <' + USER + '>\r\nTo: mahadev.dalvi@1accord.in\r\nSubject: Re: CV Submission - Jayesh Singh - IoT Cloud Engineer Intern\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nHi Mahadev,\r\n\r\nThanks for getting back to me. I am available today (Wednesday, 15 July) for the online interview. Please let me know what time works best for you and the meeting details.\r\n\r\nLooking forward to it.\r\n\r\nBest regards,\r\nJayesh Singh\r\n+91-7821816193\r\n';
function sc(c) { socket.write(c + '\r\n'); }
socket.on('data', d => {
  buf += d.toString(); const ls = buf.split('\r\n'); buf = ls.pop() || '';
  for (const l of ls) {
    if (step === 0 && l.startsWith('220 ')) { step = 1; sc('EHLO career-ops'); }
    else if (step === 1 && (l.startsWith('250 ') || l.startsWith('250-'))) { if (l.includes('AUTH') || l.startsWith('250 ')) { step = 2; sc('AUTH LOGIN'); } }
    else if (step === 2 && l.startsWith('334 ')) { step = 3; sc(Buffer.from(USER).toString('base64')); }
    else if (step === 3 && l.startsWith('334 ')) { step = 4; sc(Buffer.from(PASS).toString('base64')); }
    else if (step === 4 && l.startsWith('235 ')) { step = 5; sc('MAIL FROM:<' + USER + '>'); }
    else if (step === 5 && l.startsWith('250 ')) { step = 6; sc('RCPT TO:<mahadev.dalvi@1accord.in>'); }
    else if (step === 6 && l.startsWith('250 ')) { step = 8; sc('DATA'); }
    else if (step === 8 && l.startsWith('354 ')) { step = 9; socket.write(Buffer.from(msg, 'utf-8')); socket.write('\r\n.\r\n'); }
    else if (step === 9 && l.startsWith('250 ')) { sent = true; sc('QUIT'); }
  }
});
socket.on('close', () => { if (sent) console.log('✅ Replied to Mahadev'); else console.log('❌ Failed'); });
socket.on('error', e => console.error('ERR:', e.message));
