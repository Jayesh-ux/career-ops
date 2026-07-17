#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const [, , USER_EMAIL, APP_PASSWORD] = process.argv;
if (!USER_EMAIL || !APP_PASSWORD) {
  console.log('Usage: node check-inbox.mjs <email> <app-password>');
  process.exit(1);
}

function checkFolder(folder, cb) {
  const imap = new Imap({
    user: USER_EMAIL, password: APP_PASSWORD,
    host: 'imap.gmail.com', port: 993, tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });

  const all = [];
  let done = false;

  imap.once('ready', () => {
    imap.openBox(folder, false, (err) => {
      if (err) { imap.end(); cb([]); return; }
      const since = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0];
      imap.search(['ALL', ['SINCE', since]], (err, results) => {
        if (err || !results || results.length === 0) { imap.end(); cb([]); return; }
        const latest = results.slice(-50);
        let pending = latest.length;
        let timedOut = false;

        if (pending === 0) { imap.end(); cb([]); return; }

        const f = imap.fetch(latest, { bodies: '' });
        f.on('message', (msg) => {
          let buf = '';
          msg.on('body', (stream) => {
            stream.on('data', (chunk) => buf += chunk.toString('utf-8'));
            stream.on('end', () => {
              simpleParser(buf, (err, parsed) => {
                if (!err && parsed) {
                  all.push({
                    from: parsed.from?.text || '',
                    subject: parsed.subject || '',
                    date: parsed.date || new Date(0),
                    text: (parsed.text || '').substring(0, 300),
                  });
                }
                pending--;
                if (pending <= 0 && !timedOut) { timedOut = true; imap.end(); cb(all); }
              });
            });
          });
          msg.on('end', () => {
            // fallback in case body doesn't fire
            setTimeout(() => {
              if (pending <= 0 && !timedOut) { timedOut = true; imap.end(); cb(all); }
            }, 2000);
          });
        });
        f.once('error', () => { if (!timedOut) { timedOut = true; imap.end(); cb(all); } });
        f.once('end', () => {
          // final fallback timeout
          setTimeout(() => {
            if (!timedOut) { timedOut = true; imap.end(); cb(all); }
          }, 5000);
        });
      });
    });
  });
  imap.once('error', () => { if (!done) { done = true; cb(all); } });
  imap.connect();
}

checkFolder('INBOX', (inbox) => {
  checkFolder('[Gmail]/Spam', (spam) => {
    const all = [...inbox, ...spam];
    const seen = new Set();
    const unique = all.filter(e => {
      const k = e.from + '|' + e.subject;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    unique.sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log(`\n📬 Found ${unique.length} unique emails (${inbox.length} inbox + ${spam.length} spam)\n`);

    if (unique.length === 0) {
      console.log('❌ No emails found. You said you got more replies —');
      console.log('   maybe they came via WhatsApp/call instead of email?');
      console.log('   Or check if replies went to a different email address.');
      process.exit(0);
    }

    const jobWords = /apply|application|interview|resume|opportunity|hiring|hr@|career|thank you for|your application|we received|shortlisted|schedule|offer|challenge|assessment|react|node|developer|full.?stack|intern|position|candidate/i;
    let count = 0;
    for (const e of unique) {
      count++;
      const isJob = jobWords.test(e.subject || '') || jobWords.test(e.from || '');
      const marker = isJob ? '🔴' : '  ';
      const date = e.date ? new Date(e.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '?';
      console.log(`${marker} #${count}`);
      console.log(`   From:    ${e.from}`);
      console.log(`   Subject: ${e.subject}`);
      console.log(`   Date:    ${date}`);
      if (isJob && e.text) console.log(`   Preview: ${e.text.replace(/\n+/g, ' ').substring(0, 200)}`);
      console.log('');
    }

    const jobEmails = unique.filter(e => jobWords.test(e.subject || '') || jobWords.test(e.from || ''));
    if (jobEmails.length > 0) {
      console.log(`⚠️  ${jobEmails.length} job-related. Reply which # numbers you want me to respond to.`);
    } else {
      console.log(`❌ None look job-related. Maybe replies came via a different email (WhatsApp/call)?`);
    }
  });
});
