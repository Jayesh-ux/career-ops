import { chromium } from 'patchright';
import { readFileSync } from 'fs';
const url = process.argv[2];
const RESUME = process.env.RESUME_PATH || '/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const P = {
  name:'Jayesh Singh', email:'hsinghjayesh@gmail.com', phone:'7821816193',
  linkedin:'https://linkedin.com/in/jayesh-dev', github:'https://github.com/Jayesh-ux',
};
if(!url){console.log('usage: node lever-apply-with-resume.mjs <lever-apply-url>');process.exit(1);}
const b = await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const results={};
try{
  const p = await b.newPage();
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(e=>console.log('goto:'+e.message.slice(0,60)));
  await p.waitForTimeout(7000);
  // Fill fields by name/placeholder/label
  const fill = await p.evaluate((P)=>{
    const set=(el,val)=>{el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    const r={};
    const trySet=(name,val)=>{
      const candidates=document.querySelectorAll('input[type=text],input[type=email],input[type=tel],input[name],textarea,select');
      let done=false;
      candidates.forEach(el=>{
        const n=(el.name||'').toLowerCase(), ph=((el.placeholder||'')+(el.getAttribute('aria-label')||'')).toLowerCase();
        if(!done && (n.includes(name)||ph.includes(name))){ set(el,val); r[name]=1; done=true; }
      });
      if(!done){ const byName=document.querySelector(`input[name="${name}"]`); if(byName){set(byName,val);r[name]=1;} }
    };
    trySet('name', P.name);
    trySet('email', P.email);
    trySet('phone', P.phone);
    trySet('linkedin', P.linkedin);  // lever uses urls[LinkedIn]
    trySet('github', P.github);
    return r;
  }, P);
  results.fill = fill;
  // Upload resume
  const fi = await p.$('input[type=file]');
  if(fi){
    await fi.setInputFiles(RESUME);
    await p.waitForTimeout(2500);
    results.resumeLen = await p.evaluate(()=>{const f=document.querySelector('input[type=file]');return f&&f.files?f.files.length:-1;});
    results.fileName = await p.evaluate(()=>{const f=document.querySelector('input[type=file]');return f&&f.files&&f.files[0]?f.files[0].name:'';});
  } else { results.resumeLen='NO_FILE_INPUT'; }
  // Optional but don't submit yet? User wants auto-apply. Click submit.
  const clicked = await p.evaluate(()=>{
    const btn=[...document.querySelectorAll('button')].find(b=>/submit|apply/i.test(b.textContent));
    if(btn){btn.click();return true;} return false;
  });
  results.submitClicked = clicked;
  await p.waitForTimeout(8000);
  const after = await p.evaluate(()=>document.body.innerText.slice(0,200));
  results.pageAfter = after.replace(/\n+/g,' ').slice(0,160);
}catch(e){ console.log('FAIL:'+e.message.slice(0,200)); }
await b.close();
console.log('RESULT '+JSON.stringify(results));
