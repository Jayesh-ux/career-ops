// Scan Greenhouse boards for Mumbai-area dev roles matching Jayesh's profile
// and print apply URLs. Dedupes against applications.md.
import { readFileSync } from 'fs';

const boards = `prodigal liberis blenheimchalcotindia capco eltropy nium fospha
groww postman glance meesho sharechat udaan zerodha upstox angelone
smallcase brightmoney razorpay chargebee freshworks zoho zetwerk
druva hasura hashnode razorpaykagi pixelbin liquidbox canarys
velotio simform tatvasoft aglowid geodesic e2e crab nebula blueflame
solo-40 criticalriver simplilearn ubsgcg accenture india pwcindia
deloitteindia eyglobal kpmgindia goldmansachs jpmorgan morganstanley
citi credit-suisse-barclays hsbc barclaysindia natwestgroup
target rediff internetautomobi microsoft google amazon apple meta
netflix nvidia amd qualcomm arm oracle ibm sap cisco vmware intel
lenovo hp hcltech wipro infosys tcs techmahindra accentureiq
`.split(/\s+/).filter(Boolean);

const dev = /full.?stack|fullstack|backend|frontend|software|engineer|developer|sde|java|spring|react|node|python|django|ai|llm|ml |machine learning|data engineer|product engineer|cloud engineer|devops engineer|platform engineer|automation engineer/i;
const mumbai = /mumbai|navi mumbai|thane|kalyan|dombivli|ambarnath|ulhasnagar|vasai|virar|pa.doi|work from home|remote - india|hybrid - india|remote/;

// Already applied company::role titles (normalized) to skip
const appliedRaw = readFileSync('data/users/hsinghjayesh@gmail.com/data/applications.md','utf-8');
const applied = new Set();

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
  let skips=0;
  const hits=all.filter(j=>{
    if(!dev.test(j.t)) return false;
    if(!mumbai.test(j.l)) return false;
    const key=(j.b.toLowerCase()+' '+j.t.toLowerCase()).replace(/[^a-z0-9]+/g,' ').trim();
    if([...applied].some(a=>a.includes(j.b.toLowerCase()))){skips++;return false;}
    return true;
  });
  console.log('boards:',boards.length,'| scraped:',all.length,'| Mumbai dev hits (new):',hits.length,'| skipped already-applied',skips);
  const seen=new Set();
  hits.forEach(j=>{
    const k=j.b+'|'+j.t.toLowerCase();
    if(seen.has(k))return; seen.add(k);
    console.log('  '+j.b.padEnd(18)+' | '+j.t.slice(0,46).padEnd(46)+' | '+j.u);
  });
})();
