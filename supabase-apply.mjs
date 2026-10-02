#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const CDP_HTTP = 'http://127.0.0.1:9222';
const RESUME = '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const APPLICANT = {
  fullName: 'Jayesh Singh',
  email: 'hsinghjayesh@gmail.com',
  phone: '+91 7821816193',
  linkedin: 'https://www.linkedin.com/in/jayesh-dev',
  github: 'https://github.com/Jayesh-ux',
  website: 'https://shopsphere-ten-neon.vercel.app',
  city: 'Mumbai, India',
  workAuth: 'India',
  expYears: '1.5',
  howHeard: 'LinkedIn',
};

const COVER = (role) =>
  `Dear Supabase team,\n\nI'm Jayesh Singh, a full-stack developer (React/Next.js/TypeScript, Node.js, MERN) applying for the ${role} role. I've built and shipped production full-stack apps, including ShopSphere, a micro-frontend storefront (Zustand, Tailwind/GSAP) deployed live on Vercel. I love working with modern JavaScript, clean APIs, and developer tools, and I'd welcome the chance to contribute to Supabase.\n\nMy resume is attached.\n\nBest regards,\nJayesh Singh\n+91 7821816193 | linkedin.com/in/jayesh-dev | github.com/Jayesh-ux`;

const ROLES = {
  'Frontend Engineer': {
    custom: [
      ['how.*learn', 'LinkedIn'],
      ['legal', 'India'],
      ['timezone', 'Mumbai, India (IST)'],
      ['location', 'Mumbai, India'],
      ['portfolio|samples|work', 'https://shopsphere-ten-neon.vercel.app'],
      ['experience|years', '1.5'],
      ['anything.*else|additional', 'Looking forward to contributing to Supabase.'],
    ],
  },
  'SDK Engineer - JavaScript': {
    custom: [
      ['how.*learn', 'LinkedIn'],
      ['legal', 'India'],
      ['timezone', 'Mumbai, India (IST)'],
      ['github', 'https://github.com/Jayesh-ux'],
      ['experience|years', '1.5'],
      ['additional', 'Comfortable building JS/TS libraries and working with REST/GraphQL APIs.'],
    ],
  },
  'Engineering Productivity Engineer': {
    custom: [
      ['how.*learn', 'LinkedIn'],
      ['legal', 'India'],
      ['timezone', 'Mumbai, India (IST)'],
      ['experience|years', '1.5'],
      ['additional', 'I enjoy automating workflows, CI/CD, and developer tooling.'],
    ],
  },
};

function defaultCustom(role) {
  return ROLES[role]?.custom || [
    ['how.*learn', 'LinkedIn'],
    ['legal', 'India'],
    ['timezone', 'Mumbai, India (IST)'],
    ['experience|years', '1.5'],
    ['additional', `Eager to contribute to Supabase as a ${role}.`],
  ];
}

async function newTarget(url) {
  const vres = await fetch(`${CDP_HTTP}/json/version`);
  const v = await vres.json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const pend = new Map();
  let nid = 0;
  const on = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(methodErr(m))) : res(m.result); }
  };
  ws.addEventListener('message', on);
  const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++nid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const created = await cmd('Target.createTarget', { url: 'about:blank' });
  const { targetId } = created;
  const attached = await cmd('Target.attachToTarget', { targetId, flatten: true });
  return { ws, sessionId: attached.sessionId };
}
function methodErr(m) { try { return m.error.message; } catch { return 'cdp error'; } }

function makeSession(ws, sessionId) {
  const S = { ws, sessionId, idc: 0, pend: new Map() };
  const on = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && S.pend.has(m.id)) {
      const { res, rej } = S.pend.get(m.id);
      S.pend.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
    }
  };
  ws.addEventListener('message', on);
  S.cmd = (method, params = {}) => new Promise((res, rej) => {
    const id = ++S.idc;
    S.pend.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return S;
}

async function evalj(S, expression, awaitPromise = true, timeout = 60000) {
  const r = await S.cmd('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    timeout,
  });
  if (r?.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r?.result?.value;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runOne(role, url, dry) {
  const { ws, sessionId } = await newTarget('about:blank');
  const S = makeSession(ws, sessionId);
  const stat = { url, role, state: 'pending' };
  try {
    await S.cmd('Page.enable');
    await S.cmd('Page.navigate', { url });
    // wait for load
    let loaded = false;
    for (let i = 0; i < 60; i++) {
      const ready = await evalj(S, 'document.readyState', false).catch(() => '');
      if (ready === 'complete') { loaded = true; break; }
      await sleep(800);
    }
    if (!loaded) { stat.state = 'load_failed'; return stat; }

    // already-applied guard + open form
    const opened = await evalj(S, `(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const t=(document.body.innerText||'');
      if(/already applied|thank you for applying/i.test(t)) return 'ALREADY';
      let b=[...document.querySelectorAll('button,a,span')].find(el=>{const s=(el.innerText||el.textContent||'').trim().toLowerCase(); return ['apply for this job','apply now','apply for this role'].includes(s);});
      if(b) b.click();
      for(let i=0;i<40;i++){ await wait(300); if(document.querySelector('input[type=email], input[name*="full_name"], input[name="name"], input[name="candidate[full_name]"]')) return 'FORM_OPEN'; }
      return 'NO_FORM';
    })()`);
    if (opened === 'ALREADY') { stat.state = 'already_applied'; return stat; }
    if (opened !== 'FORM_OPEN') { stat.state = 'no_form'; return stat; }

    // inspect questions/labels
    const probe = await evalj(S, `JSON.stringify([...document.querySelectorAll('input,textarea,select')].map(el=>({
      type:el.type||'', name:el.name||'', ph:el.placeholder||'', label:(el.closest('label')?.innerText||el.getAttribute('aria-label')||'').trim().slice(0,120), req:el.required, vis:(el.offsetParent!==null)
    })).filter(x=>x.vis||x.type==='file'))`);
    if (dry) {
      stat.state = 'probe';
      stat.inputs = JSON.parse(probe);
      return stat;
    }

    // fill
    const customJson = JSON.stringify(defaultCustom(role));
    const coverJson = JSON.stringify(COVER(role));
    const fillExpr = `(()=>{
      const A=${JSON.stringify(APPLICANT)};
      const custom=${customJson};
      const cover=${coverJson};
      const setv=(el,v)=>{ const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; const desc=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value'); desc.set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
      const norm=s=>(s||'').toLowerCase().replace(/\s+/g,' ');
      const out={filled:[],missed:[],customMatches:[]};
      let fileSeen=false;
      for(const el of document.querySelectorAll('input,textarea,select')){
        if(el.type==='hidden') continue;
        const t=el.type||''; const n=norm(el.name); const ph=norm(el.placeholder); const lab=norm(el.closest('label')?.innerText||el.getAttribute('aria-label')||'');
        if(t==='file'){ fileSeen=true; continue; }
        if(t==='radio'||t==='checkbox'){ continue; }
        let v='';
        const c=n+' '+ph+' '+lab;
        if(n.includes('full_name')||c.includes('full name')) v=A.fullName;
        else if(n.includes('first')||c.includes('first name')) v=A.fullName.split(' ')[0];
        else if(n.includes('last')||c.includes('last name')) v=A.fullName.split(' ').slice(1).join(' ');
        else if(t==='email'||n==='email'||c.includes('email')) v=A.email;
        else if(n.includes('phone')||c.includes('phone')) v=A.phone;
        else if(n.includes('linkedin')||c.includes('linkedin')) v=A.linkedin;
        else if(n.includes('github')||c.includes('github')) v=A.github;
        else if(n.includes('city')||c.includes('location')||n.includes('address')) v=A.city;
        else if(n.includes('tz')||c.includes('timezone')) v='Mumbai, India (IST)';
        else if(n.includes('website')||n.includes('portfolio')) v=A.website;
        else if(t==='textarea') v=cover+ (lab.match(/questions|anything|additional|comment/) ? '\\n\\nPlease feel free to reach out with any follow-up questions.' : '');
        else if(custom.length){
          const m=custom.find(([re])=>new RegExp(re).test(c));
          if(m){ v=m[1]; out.customMatches.push(lab||n); custom.splice(custom.indexOf(m),1); }
        }
        if(v){ try{ setv(el,v); out.filled.push(lab||n||el.name); }catch(e){ out.missed.push((lab||n)+':error'); } }
      }
      return JSON.stringify({...out,fileSeen});
    })()`;
    const fill = await evalj(S, fillExpr);
    stat.fill = JSON.parse(fill);

    // resume upload via CDP DOM domain if file input present
    const { DOM } = { DOM: null };
    const fileInfo = await evalj(S, `(()=>{const f=document.querySelector('input[type=file]'); if(!f) return null; f.setAttribute('data-cv-target','1'); return JSON.stringify({count:document.querySelectorAll('input[type=file]').length});})()`);
    if (fileInfo) {
      const doc = await S.cmd('DOM.getDocument');
      const node = await S.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-cv-target="1"]' });
      if (node.nodeId) {
        await S.cmd('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [RESUME] });
        stat.cv = 'uploaded';
      } else { stat.cv = 'no_node'; }
    } else { stat.cv = 'no_file_input'; }

    // submit
    await sleep(1200);
    const sub = await evalj(S, `(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const btn=document.querySelector('button[type="submit"]')||[...document.querySelectorAll('button')].find(b=>/submit application|submit/i.test(b.innerText)&&b.offsetParent!==null);
      if(!btn){ wait(2500); return JSON.stringify({ok:false,err:'no_submit_btn'}); }
      btn.click();
      for(let i=0;i<50;i++){ await wait(500);
        const t=(document.body?.innerText||'');
        if(/applied|submitted|thank you|received your application|application received/i.test(t)&&!/(csv)/.test(t)) return JSON.stringify({ok:true,snip:t.replace(/\\s+/g,' ').slice(0,160)});
      }
      const now=(document.body?.innerText||'').replace(/\\s+/g,' ').slice(-260);
      return JSON.stringify({ok:false,err:'no_confirmation',tail:now});
    })()`);
    stat.submit = JSON.parse(sub);
    stat.state = sub.ok ? 'submitted' : 'failed';
    return stat;
  } catch (e) {
    stat.state = 'error';
    stat.error = e.message;
    return stat;
  } finally {
    try { await S.cmd('Page.close'); } catch {}
    ws.close();
  }
}

const JOBS = [
  ['Frontend Engineer', 'https://jobs.ashbyhq.com/supabase/f048dd68-63f8-4f98-9860-3d5a43c09a01'],
  ['SDK Engineer - JavaScript', 'https://jobs.ashbyhq.com/supabase/f44742fb-18c6-478f-bf78-63707ed57db7'],
  ['Engineering Productivity Engineer', 'https://jobs.ashbyhq.com/supabase/8229db66-dc3f-4ffe-8d86-90ce9ffb4c90'],
  ['Software Engineer - Branching', 'https://jobs.ashbyhq.com/supabase/06752423-eebb-472c-95b5-c7ff2559fd60'],
  ['Platform Engineer - Compute Capacity', 'https://jobs.ashbyhq.com/supabase/4eb14408-51e6-4c58-812a-3782d5c0b045'],
  ['Database Support Engineer (EMEA)', 'https://jobs.ashbyhq.com/supabase/3889002e-536e-4046-a330-70e942b0cc96'],
  ['Support Engineer (EMEA)', 'https://jobs.ashbyhq.com/supabase/c01f7436-1fdd-4a3e-8b96-8cadc33b006e'],
  ['Platform Security Engineer (AMER/APAC)', 'https://jobs.ashbyhq.com/supabase/8fa1c7a0-a85c-4562-a1f5-4dd22cadae27'],
];

const dry = process.argv.includes('--dry');
const onlyIdx = process.argv.indexOf('--only');
const only = process.argv.includes('--only') ? process.argv[onlyIdx + 1] : '';
const targets = JOBS.filter(([role]) => !only || role.includes(only));

(async () => {
  console.log(`WAVE: ${targets.length} postings${dry ? ' (DRY RUN)' : ''}`);
  const out = [];
  for (const [role, url] of targets) {
    const r = await runOne(role, url, dry);
    console.log(`# ${r.state.toUpperCase().padEnd(8)} ${role} | cv=${r.cv || ''} | submit=${r.submit?.ok ? 'OK' : (r.submit?.err || '')}`);
    if (r.fill) console.log('    filled:', r.fill.filled?.length, 'missed:', r.fill.missed?.length, 'custom:', r.fill.customMatches?.length);
    if (r.inputs && r.inputs.length) {
      console.log('    PROBE inputs:');
      for (const i of r.inputs) if (i.vis || i.type === 'file') console.log(`      - ${i.type || 'in'}  name=${i.name || '-'}  ph=${i.ph || '-'}  label=${i.label.slice(0, 60)}  req=${i.req}`);
    }
    out.push(r);
    await sleep(2000);
  }
  writeFileSync('/tmp/supabase-wave-result.json', JSON.stringify(out, null, 2));
  console.log('\nSaved /tmp/supabase-wave-result.json');
})().catch((e) => { console.error(e); process.exit(1); });