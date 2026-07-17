#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Imap = require('imap');

const [, , USER_EMAIL, APP_PASSWORD] = process.argv;
if (!USER_EMAIL || !APP_PASSWORD) { console.log('Usage: ...'); process.exit(1); }

const TRASH_SENDERS = [
  'claritytraders.com', 'Nina at Clarity',
  'kotak', 'Kotak811', 'Kotak 811',
  'pinterest.com', 'myntra.com', 'samsung',
  'mail.adobe.com', 'iconscout.com', 'havells',
  'quora.com', 'hinge.co',
  'nanubhaiproperty.com', 'usestrix.com',
  'hello@contra.com',
  'aliexpress.com', 'aliexpress',
  'amazonpay.in', 'amazon pay',
  'noreply-accounts@google.com', 'google.com',
  'bankalerts@kotak.bank.in',
  'retailproducts@mail.kotakalert.bank.in',
];

function cleanFolder(folder) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: USER_EMAIL, password: APP_PASSWORD,
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });
    let trashed = 0;

    imap.once('ready', () => {
      imap.openBox(folder, false, (err, box) => {
        if (err || !box) { imap.end(); resolve(0); return; }
        console.log(`   Folder has ${box.messages.total} messages`);
        if (box.messages.total === 0) { imap.end(); resolve(0); return; }

        const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        imap.search(['ALL', ['SINCE', since]], (err, results) => {
          if (err) { console.log('   Search error:', err.message); imap.end(); resolve(0); return; }
          if (!results || results.length === 0) { console.log('   No emails in date range'); imap.end(); resolve(0); return; }
          
          console.log(`   Scanning ${results.length} emails from last 30 days...`);
          
          const toTrash = [];
          let completed = 0;
          let fetchDone = false;

          const fetch = imap.fetch(results, { bodies: ['HEADER.FIELDS (FROM SUBJECT)'] });
          fetch.on('message', (msg, seqno) => {
            let header = '';
            msg.on('body', (stream) => {
              stream.on('data', c => header += c.toString());
            });
            msg.on('end', () => {
              completed++;
              const from = (header.match(/^From: (.+)$/mi) || [''])[1] || '';
              const subj = (header.match(/^Subject: (.+)$/mi) || [''])[1] || '';
              
              const shouldTrash = TRASH_SENDERS.some(s => from.toLowerCase().includes(s.toLowerCase()));
              
              if (shouldTrash) {
                toTrash.push(seqno);
                console.log(`   🗑️  #${seqno}: [${from.substring(0,30).trim()}] ${subj.substring(0,45)}`);
              }
            });
          });

          fetch.once('end', () => {
            fetchDone = true;
            console.log(`   Fetch complete. Scanned ${completed} emails, ${toTrash.length} to trash.`);
            
            if (toTrash.length > 0) {
              imap.addFlags(toTrash, '\\Deleted', (err) => {
                if (err) { console.log('   Add flags error:', err.message); imap.end(); resolve(0); return; }
                imap.expunge((err) => {
                  if (err) console.log('   Expunge error:', err.message);
                  trashed = toTrash.length;
                  imap.end();
                  resolve(trashed);
                });
              });
            } else {
              imap.end();
              resolve(0);
            }
          });

          fetch.once('error', (err) => {
            console.log('   Fetch error:', err.message);
            imap.end();
            resolve(0);
          });
        });
      });
    });
    imap.once('error', (err) => { console.log('   IMAP error:', err.message); resolve(0); });
    imap.connect();
  });
}

(async () => {
  console.log('🧹 Cleaning inbox...\n');
  const count = await cleanFolder('INBOX');
  console.log(`\n✅ Moved ${count} spam/promotional emails to trash.`);
  if (count > 0) console.log('   (Gmail auto-empties trash after 30 days)');
})();
