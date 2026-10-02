import { chromium } from 'patchright';
const url = 'https://zfrmz.com/pAKb2ynfomIsuNwRfRbV';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const p = await b.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(9000);
  const r = await p.evaluate(() => {
    const set = (sel, val) => { const el = document.querySelector(sel); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    const sel = document.querySelector('select[name=Dropdown1]');
    const opt = [...(sel?.options || [])].find(o => /GenAI|Gen AI|LLM Engineer/i.test(o.text));   set('select[name=Dropdown1]', opt ? opt.value : '');
    const names = document.querySelectorAll('input[name=Name]');
    if (names[0]) { names[0].value = 'Jayesh Singh'; names[0].dispatchEvent(new Event('input', { bubbles: true })); }
    if (names[1]) { names[1].value = 'hsinghjayesh@gmail.com'; names[1].dispatchEvent(new Event('input', { bubbles: true })); }
    set('input[name=PhoneNumber]', '+91 7821816193');
    const male = document.querySelector('input[name=Radio][id=Radio_1]');
    if (male) male.click();
    set('input[name=Address]', 'Kalyan (W) 421301, Maharashtra, India');
    const apply = [...document.querySelectorAll('button,[type=submit]')].find(x => /apply/i.test(x.innerText || x.value || ''));
    if (apply) apply.click();
    return { clicked: !!apply, dropdown: document.querySelector('select[name=Dropdown1]')?.options.length };
  });
  await p.waitForTimeout(9000);
  const after = await p.evaluate(() => ({ url: location.href, title: document.title, body: (document.body.innerText || '').slice(0, 250) }));
  console.log(JSON.stringify({ filled: r, after }, null, 1));
} catch (e) { console.log('FAIL:' + e.message.slice(0, 200)); }
await b.close();
