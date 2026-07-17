#!/usr/bin/env node
import * as tls from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , USER_EMAIL, APP_PASSWORD] = process.argv;
if (!USER_EMAIL || !APP_PASSWORD) { console.log('Usage: ...'); process.exit(1); }

const HOST='smtp.gmail.com', PORT=465;
const FROM='Jayesh Singh';
const to='umama.sayed@unicoconnect.com';
const subject='=?UTF-8?Q?Follow-up: Software Engineering Intern Application?=';
const body=`Dear Umama,

I hope you're doing well. I wanted to politely follow up on my application — we spoke earlier and you mentioned you'd discuss with the manager. Just checking if there are any updates or next steps.

Happy to hop on another call if needed.

Best regards,
Jayesh Singh
+91-7821816193`;

new Promise((resolve, reject) => {
  const s=tls.connect(PORT,HOST,()=>s.setTimeout(15000));
  let step=0,buf='',sent=false;
  const msg=`From: ${FROM} <${USER_EMAIL}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n`;
  const sc=c=>s.write(c+'\r\n');
  s.on('data',d=>{
    buf+=d.toString();
    const lines=buf.split('\r\n'); buf=lines.pop()||'';
    for(const l of lines){
      if(step===0&&l.startsWith('220 ')){step=1;sc('EHLO career-ops');}
      else if(step===1&&(l.startsWith('250 ')||l.startsWith('250-'))){if(l.includes('AUTH')||l.startsWith('250 ')){step=2;sc('AUTH LOGIN');}}
      else if(step===2&&l.startsWith('334 ')){step=3;sc(Buffer.from(USER_EMAIL).toString('base64'));}
      else if(step===3&&l.startsWith('334 ')){step=4;sc(Buffer.from(APP_PASSWORD).toString('base64'));}
      else if(step===4&&l.startsWith('235 ')){step=5;sc(`MAIL FROM:<${USER_EMAIL}>`);}
      else if(step===5&&l.startsWith('250 ')){step=6;sc(`RCPT TO:<${to}>`);}
      else if(step===6&&l.startsWith('250 ')){step=7;sc('DATA');}
      else if(step===7&&l.startsWith('354 ')){step=8;s.write(msg+'\r\n.\r\n');}
      else if(step===8&&l.startsWith('250 ')){sent=true;sc('QUIT');}
      else if(l.startsWith('535 ')){reject(new Error('Auth failed'));s.end();}
    }
  });
  s.on('error',reject);
  s.on('timeout',()=>reject(new Error('Timeout')));
  s.on('close',()=>{if(sent)resolve();else reject(new Error('Failed'));});
}).then(()=>console.log('✅ Follow-up sent to Umama')).catch(e=>console.error('❌',e.message));
