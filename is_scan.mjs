import { chromium } from 'playwright-core';
import fs from 'fs';
const d = JSON.parse(fs.readFileSync('/tmp/targets_is.json','utf8'));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const live=[];
for (const t of d){
  const url=t.url, slug=(url.split('/detail/')[1]||url).slice(0,50);
  try{
    const p=await ctx.newPage();
    p.setDefaultTimeout(12000);
    await p.goto(url,{timeout:12000,waitUntil:'commit'}).catch(()=>{});
    await sleep(1400);
    const r=await p.evaluate(()=>{
      const h1=(document.querySelector('h1')?.innerText||'').trim().slice(0,80);
      const body=document.body?document.body.innerText:'';
      return {title:document.title, h1, is404:!h1&&body.includes('Take off again')};
    }).catch(()=>({title:'',h1:'',is404:true}));
    const status=r.is404?'404':'LIVE';
    process.stdout.write(status+' '+r.title.slice(0,30)+' | '+r.h1.slice(0,45)+' | '+slug+'\n');
    if(!r.is404&&r.h1) live.push(url);
    await p.close().catch(()=>{});
  }catch(e){ process.stdout.write('ERR '+slug+'\n'); }
}
fs.writeFileSync('/tmp/is_live.json',JSON.stringify(live));
console.log('LIVE COUNT:',live.length);
process.exit(0);
