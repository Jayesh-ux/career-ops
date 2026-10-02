// Scan Greenhouse boards for Remote-INDIA / WFH dev roles matching Jayesh's profile.
import { readFileSync } from 'fs';

const boards = `prodigal liberis blenheimchalcotindia capco eltropy nium fospha
groww postman glance meesho sharechat udaan zerodha upstox angelone
smallcase chargebee freshworks zoho zetwerk druva hasura hashnode
pixelbin liquidbox canarys velotio simform tatvasoft geodesic
aquent craft kforce myriadgames adept zepto blinkit swiggy razorpay
fractal wipro infosys tcs techmahindra hcltech accenture turing
andela rocket software insight lti mindtree techwill xebia katalon
grnet f22 sage quickbooks horillasw grapevine gr8 dailyhunt
lokal newsify anialatirus republic media jio reli jabong myntra
fashionara clustermaproject zypdetails newreralabs pinehire zeroscale
`.split(/\s+/).filter(Boolean);

const dev = /full.?stack|fullstack|backend|frontend|software|engineer|developer|sde|java|spring|react|node|python|django|ai|llm|machine learning|ml engineer|data engineer|product engineer|cloud engineer|devops|platform engineer/i;
const remoteIndia = /remote|work from home|wfh|anywhere/i;

const appliedRaw = readFileSync('data/users/hsinghjayesh@gmail.com/data/applications.md','utf-8');
const appliedB = [...appliedRaw.matchAll(/\|\s*([A-Za-z0-9 &.-]+)\s*\|\s*([A-Za-z0-9+/& .-]*?)\s*\|\s*(?:Strong|Moderate|Weak|Poor)\s*\|\s*Applied/g)].map(m=>(m[1]+' '+m[2]).toLowerCase());

async function get(b){
  try{
    const r=await fetch('https://boards-api.greenhouse.io/v1/boards/'+b+'/jobs',{signal:AbortSignal.timeout(9000)});
    if(!r.ok) return [];
    const d=await r.json();
    return (d.jobs||[]).map(j=>({b,t:j.title||'',l:(j.location&&j.location.name)||'',u:j.absolute_url||''}));
  }catch{return []}
}

(async()=>{
  const all=(await Promise.all(boards.map(get))).flat();
  const hits=all.filter(j=>{
    if(!dev.test(j.t)) return false;
    if(!remoteIndia.test(j.l)) return false;
    const key=(j.b+' '+j.t).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    return !appliedB.some(a=>a.includes(j.b.toLowerCase()));
  });
  console.log('boards:',boards.length,'| scraped:',all.length,'| Remote-India dev hits:',hits.length);
  const seen=new Set();
  hits.forEach(j=>{
    const k=j.b+'|'+j.t.toLowerCase();
    if(seen.has(k))return; seen.add(k);
    console.log('  '+j.b.padEnd(18)+' | '+j.t.slice(0,44).padEnd(44)+' | '+j.u);
  });
})();
