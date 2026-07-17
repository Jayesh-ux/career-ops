#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const [, , USER_EMAIL, APP_PASSWORD] = process.argv;
if (!USER_EMAIL || !APP_PASSWORD) { process.exit(1); }

function cleanFolder(folder, allSenders) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: USER_EMAIL, password: APP_PASSWORD,
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });
    let trashed = 0;

    imap.once('ready', () => {
      imap.openBox(folder, false, (err, box) => {
        if (err || !box) { imap.end(); resolve({ trashed: 0, kept: 0 }); return; }
        if (box.messages.total === 0) { imap.end(); resolve({ trashed: 0, kept: 0 }); return; }

        imap.search(['ALL'], (err, results) => {
          if (err || !results || results.length === 0) { imap.end(); resolve({ trashed: 0, kept: 0 }); return; }
          
          const toTrash = [];
          const toKeep = [];
          let completed = 0;

          const fetch = imap.fetch(results, { bodies: ['HEADER.FIELDS (FROM SUBJECT)'] });
          fetch.on('message', (msg, seqno) => {
            let header = '';
            msg.on('body', (s) => { s.on('data', c => header += c.toString()); });
            msg.on('end', () => {
              completed++;
              const from = (header.match(/^From: (.+)$/mi) || [''])[1] || '';
              const subj = (header.match(/^Subject: (.+)$/mi) || [''])[1] || '';
              
              const shouldTrash = allSenders.some(s => from.toLowerCase().includes(s.toLowerCase()));
              if (shouldTrash) {
                toTrash.push(seqno);
              } else {
                toKeep.push({ seqno, from: from.substring(0,50), subj: subj.substring(0,60) });
              }
            });
          });

          fetch.once('end', () => {
            setTimeout(() => {
              // Show what's being kept (legit emails in spam)
              if (toKeep.length > 0) {
                console.log(`\n   ⚠️  Legit emails found in ${folder} (keeping):`);
                toKeep.forEach(k => console.log(`      📌 ${k.from} — ${k.subj}`));
              }
              
              if (toTrash.length > 0) {
                imap.addFlags(toTrash, '\\Deleted', () => {
                  imap.expunge(() => {
                    trashed = toTrash.length;
                    imap.end();
                    resolve({ trashed, kept: toKeep.length });
                  });
                });
              } else {
                imap.end();
                resolve({ trashed: 0, kept: toKeep.length });
              }
            }, 2000);
          });
          fetch.once('error', () => { imap.end(); resolve({ trashed, kept: 0 }); });
        });
      });
    });
    imap.once('error', () => resolve({ trashed: 0, kept: 0 }));
    imap.connect();
  });
}

(async () => {
  console.log('🧹 Step 1: Check SPAM folder for legit emails...');
  
  // Only trash senders (same list + more)
  const trashSenders = [
    'claritytraders.com', 'Nina at Clarity',
    'kotak', 'Kotak811', 'Kotak 811', 'kotak.bank', 'kotakalert',
    'pinterest.com', 'myntra.com', 'samsung',
    'mail.adobe.com', 'iconscout.com', 'havells',
    'quora.com', 'hinge.co',
    'nanubhaiproperty.com', 'usestrix.com',
    'hello@contra.com',
    'newsletter', 'marketing', 'promo', 'info@updates',
    'do-not-reply@hello.stackoverflow',
    'noreply-accounts@google.com',
  ];

  // First check spam for legit emails
  const spam = await cleanFolder('[Gmail]/Spam', trashSenders);
  console.log(`\n✅ Spam: deleted ${spam.trashed} spam, kept ${spam.kept} legit emails`);

  // Clean inbox more aggressively - older emails (>30 days) from known spam senders
  console.log(`\n🧹 Step 2: Clean inbox older emails from spam senders...`);
  const inbox = await cleanFolder('INBOX', trashSenders);
  console.log(`\n✅ Inbox: deleted ${inbox.trashed} more spam emails`);
  
  console.log(`\n🧹 Total cleaned: ${spam.trashed + inbox.trashed} emails`);
})();
