import { chromium } from 'patchright';
import { readFileSync } from 'fs';
const url=process.argv[2];
const RESUME='/mnt/sdcard/jobapply/Jayesh_Singh_Resume_CGPA_Updated-2.pdf';
const P={name:'Jayesh Singh',email:'hsinghjayesh@gmail.com',phone:'7821816193',linkedin:'https://linkedin.com/in/jayesh-dev',github:'https://github.com/Jayesh-ux',curr:'220000',exp:'800000'};
const FILL_SRC=readFileSync(new URL('./fill-logic.js',import.meta.url),'utf8').trim();
const expr=FILL_SRC; // (function(P){...})
const fnBody=expr.slice(1,-1).trim(); // function(P){...}
const FILL='('+fnBody+')('+JSON.stringify(P)+')';
const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const r={startUrl:url};
try{
 const p=await b.newPage();
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(e=>r.gotoErr=e.message.slice(0,40));
 await p.waitForTimeout(7000);
 r.leftover=await p.evaluate(FILL);
 const fi=await p.$('input[type=file]'); if(fi){await fi.setInputFiles(RESUME);await p.waitForTimeout(2500);r.resumeLen=await p.evaluate(()=>{var f=document.querySelector('input[type=file]');return f&&f.files?f.files.length:-1;});}else r.resumeLen='NO_FILE';
 r.ready=await p.evaluate(()=>{var btn=[].find.call(document.querySelectorAll('button'),function(b){return /submit/i.test(b.textContent);});return btn?btn.disabled:'nobtn';});
 r.clicked=await p.evaluate(()=>{var btn=[].find.call(document.querySelectorAll('button'),function(b){return /submit/i.test(b.textContent);});if(btn){btn.click();return true;}return false;});
 try{await p.waitForLoadState('networkidle',{timeout:15000});}catch(e){}
 await p.waitForTimeout(12000);
 r.endUrl=await p.url();
 r.final=await p.evaluate(()=>{var t=document.body.innerText.replace(/\s+/g,' ');var submitted=/your application has been (received|sent|submitted)|thank you for applying|application (submitted|sent|received)/i.test(t);var err=/please fix|some required|there was an error|complete the following/i.test(t);return{submitted,err,snip:t.slice(0,150)};});
}catch(e){r.fail=e.message.slice(0,150);}
await b.close();console.log('RESULT '+JSON.stringify(r));
