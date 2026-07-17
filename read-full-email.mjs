#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const [, , USER_EMAIL, APP_PASSWORD] = process.argv;
if (!USER_EMAIL || !APP_PASSWORD) { process.exit(1); }

function findLatestFrom(senderMatch) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: USER_EMAIL, password: APP_PASSWORD,
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    let resolved = false;

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); reject(err); return; }
        const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        imap.search(['ALL', ['SINCE', since]], (err, results) => {
          if (err || !results || results.length === 0) { imap.end(); reject(new Error('No results')); return; }
          
          const toFetch = results.slice(-100);
          const allEmails = [];
          let pending = toFetch.length;

          const fetch = imap.fetch(toFetch, { bodies: '' });
          fetch.on('message', (msg) => {
            let buf = '';
            msg.on('body', (stream) => {
              stream.on('data', c => buf += c.toString());
            });
            msg.on('end', () => {
              simpleParser(buf, (_, parsed) => {
                if (parsed && parsed.from) {
                  allEmails.push(parsed);
                }
                pending--;
              });
            });
          });

          fetch.once('end', () => {
            const wait = setInterval(() => {
              if (pending <= 0) {
                clearInterval(wait);
                // Sort by date descending
                allEmails.sort((a, b) => new Date(b.date) - new Date(a.date));
                const found = allEmails.filter(e => 
                  e.from?.text?.toLowerCase().includes(senderMatch.toLowerCase())
                );
                imap.end();
                if (!resolved) { resolved = true; resolve(found.length > 0 ? found[0] : null); }
              }
            }, 500);
            setTimeout(() => {
              if (!resolved) { resolved = true; imap.end(); resolve(null); }
            }, 10000);
          });
          fetch.once('error', (e) => { if (!resolved) { resolved = true; imap.end(); reject(e); } });
        });
      });
    });
    imap.once('error', (e) => { if (!resolved) { resolved = true; reject(e); } });
    imap.connect();
  });
}

(async () => {
  try {
    const email = await findLatestFrom('khan.abdul@miko.ai');
    if (!email) {
      console.log('Email from khan.abdul@miko.ai not found.');
      process.exit(1);
    }
    console.log('='.repeat(60));
    console.log('From:    ' + (email.from?.text || '?'));
    console.log('Subject: ' + (email.subject || '?'));
    console.log('Date:    ' + (email.date || '?'));
    console.log('='.repeat(60));
    console.log('\n--- FULL TEXT BODY ---\n');
    console.log(email.text || '(no text body)');
    
    if (email.html) {
      console.log('\n--- HTML BODY (tags stripped) ---\n');
      console.log(email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 3000));
    }
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
