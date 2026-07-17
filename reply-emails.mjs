#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Imap = require('imap');
import { simpleParser } from 'mailparser';

const [, , USER_EMAIL, APP_PASSWORD] = process.argv;
if (!USER_EMAIL || !APP_PASSWORD) { console.log('Usage: ...'); process.exit(1); }

const HOST='smtp.gmail.com', PORT=465;
const FROM='Jayesh Singh';

function send(to, body) {
  return new Promise((resolve, reject) => {
    const s = require('tls').connect(PORT, HOST, () => s.setTimeout(15000));
    let step = 0, buf = '', sent = false;
    const msg = `From: ${FROM} <${USER_EMAIL}>\r\nTo: ${to}\r\nSubject: Re: Miko.ai Java Developer Opportunity\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n`;
    const sc = c => s.write(c + '\r\n');
    s.on('data', d => {
      buf += d.toString();
      for (const l of buf.split('\r\n')) {
        if (step===0 && l.startsWith('220 ')) { step=1; sc('EHLO career-ops'); }
        else if (step===1 && (l.startsWith('250 ')||l.startsWith('250-'))) { if (l.includes('AUTH')||l.startsWith('250 ')) { step=2; sc('AUTH LOGIN'); } }
        else if (step===2 && l.startsWith('334 ')) { step=3; sc(Buffer.from(USER_EMAIL).toString('base64')); }
        else if (step===3 && l.startsWith('334 ')) { step=4; sc(Buffer.from(APP_PASSWORD).toString('base64')); }
        else if (step===4 && l.startsWith('235 ')) { step=5; sc(`MAIL FROM:<${USER_EMAIL}>`); }
        else if (step===5 && l.startsWith('250 ')) { step=6; sc(`RCPT TO:<${to}>`); }
        else if (step===6 && l.startsWith('250 ')) { step=7; sc('DATA'); }
        else if (step===7 && l.startsWith('354 ')) { step=8; s.write(msg + '\r\n.\r\n'); }
        else if (step===8 && l.startsWith('250 ')) { sent = true; sc('QUIT'); }
        else if (l.startsWith('535 ')) { reject(new Error('Auth failed')); s.end(); }
      }
      buf = '';
    });
    s.on('error', reject);
    s.on('timeout', () => reject(new Error('Timeout')));
    s.on('close', () => { if (sent) resolve(); else reject(new Error('Failed')); });
  });
}

(async () => {
  console.log('📧 Replying to Miko.ai...');
  await send('khan.abdul@miko.ai',
`Dear Abdul,

Thank you for reaching out. I am very interested in the Junior Java Developer role at Miko.ai.

I have hands-on experience with Java, Spring Boot, and building production applications. I have developed full-stack platforms using Java/Spring Boot with React frontends and PostgreSQL databases. I am based in Kalyan and Mumbai is easily commutable.

Please let me know the next steps — happy to share my updated resume and connect for an interview.

Best regards,
Jayesh Singh
+91-7821816193`
  );
  console.log('✅ Reply sent to Miko.ai');
  console.log('\nThe rest (#3,5,6,8,10,11,12,13,16,17,19,27,28,30,34,36,37,39,41,43,46,47)');
  console.log('are automated platform alerts from no-reply addresses — cannot be replied to.');
})();
