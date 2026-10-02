import { chromium } from 'patchright';
const url = process.argv[2];
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const p = await b.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(9000);
  const r = await p.evaluate(() => {
    const inputs = [];
    document.querySelectorAll('input,textarea,select').forEach(el => {
      inputs.push({
        tag: el.tagName, type: el.type || '', name: el.name || '',
        label: (el.labels && el.labels[0] && el.labels[0].innerText || '').trim().slice(0, 60),
        placeholder: (el.placeholder || '').slice(0, 60),
        required: el.required, accept: el.accept || '', id: el.id || ''
      });
    });
    const buttons = [];
    document.querySelectorAll('button,[type=submit]').forEach(btn => {
      buttons.push((btn.innerText || btn.value || btn.getAttribute('data-qa') || '').trim().slice(0, 40));
    });
    const fileInputs = [];
    document.querySelectorAll('input[type=file]').forEach(f => fileInputs.push({ name: f.name, accept: f.accept }));
    return { title: document.title, url: location.href, inputs, buttons: [...new Set(buttons)], fileInputs };
  });
  console.log(JSON.stringify(r, null, 1));
} catch (e) { console.log('FAIL:' + e.message.slice(0, 150)); }
await b.close();
