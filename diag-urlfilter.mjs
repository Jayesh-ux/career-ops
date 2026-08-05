function isJobDetailUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  const host = (u.hostname || '').toLowerCase();
  const path = (u.pathname || '').toLowerCase();
  if (/\/(?:login|signup|register|log-in|sign-in|blog|faq|help|contact|about|search|job-alert|alerts|recommendations)\b/.test(path)) return false;
  if (host.endsWith('shine.com')) return /\/jobs?\//.test(path);
  if (host.endsWith('timesjobs.com')) return /\/jobdetail\//.test(path);
  if (host.endsWith('internshala.com')) return /\/job\/detail\//.test(path) && !/(\?|&)utm_/i.test(u.search);
  if (host.endsWith('naukri.com')) return /\/job\//.test(path);
  if (host.endsWith('foundit.in') || host.endsWith('foundit.com')) return /\/job\//.test(path);
  if (host.endsWith('instahyre.com')) return /\/job\//.test(path);
  if (host.endsWith('indeed.com')) return /\/viewjob\b/.test(path);
  if (host.endsWith('linkedin.com')) return /\/jobs\/view\//.test(path);
  if (host.endsWith('hirist.tech')) return /^\/j\//.test(path);
  if (host.endsWith('cutshort.io')) return /^\/job\//.test(path);
  if (host.endsWith('apna.co')) return /^\/job\//.test(path);
  return true;
}

const cases = [
  ['KEEP', 'https://www.shine.com/jobs/software-developer-backend-engineer/coverfox-insurance/19260031'],
  ['KEEP', 'https://www.shine.com/job/software-developer/xyz/12345'],
  ['DROP', 'https://www.shine.com/job-search/developer-jobs-in-mumbai'],
  ['DROP', 'https://www.shine.com/blog/software-developer-job-description'],
  ['KEEP', 'https://www.timesjobs.com/jobdetail/some-job-id-123'],
  ['DROP', 'https://www.timesjobs.com/job-search?keywords=%22java+developer%22'],
  ['KEEP', 'https://internshala.com/job/detail/backend-developer-job-in-mumbai-at-sentriscope1784269250'],
  ['DROP', 'https://internshala.com/fresher-jobs/software-developer-jobs-in-mumbai/'],
  ['DROP', 'https://trainings.internshala.com/full-stack-web-development-placement-guarantee-course/?utm_source=is_web_faq_search_page'],
  ['DROP', 'https://internshala.com/internships/software-developer-jobs-in-mumbai/'],
  ['KEEP', 'https://www.naukri.com/job/backend-developer-xyz-1234'],
  ['DROP', 'https://www.naukri.com/full-stack-jobs-in-mumbai'],
  ['KEEP', 'https://in.indeed.com/viewjob?jk=abc123'],
  ['DROP', 'https://in.indeed.com/jobs?q=developer'],
  ['KEEP', 'https://www.foundit.in/job/some-post-id'],
  ['DROP', 'https://www.foundit.in/software-developer-jobs-in-mumbai'],
  ['KEEP', 'https://in.linkedin.com/jobs/view/backend-developer-node-js-at-rejolut-a-genai-web-3-0-company-4306115463?position=30&pageNum=0'],
  ['DROP', 'https://www.linkedin.com/jobs/'],
  ['DROP', 'https://www.linkedin.com/jobs/search?keywords=developer'],
  ['KEEP', 'https://www.hirist.tech/j/senior-software-engineer-backend-development-1640619?jobPos=3'],
  ['DROP', 'https://www.hirist.tech/c/frontend-development-jobs.html?ref=custom404'],
  ['DROP', 'https://www.hirist.tech/k/machine-learning-jobs'],
  ['DROP', 'https://www.hirist.tech/job-search/full-stack-developer-jobs-mumbai'],
  ['KEEP', 'https://cutshort.io/job/Senior-Full-stack-Engineer-Sprinto-Rqw1mekJ'],
  ['DROP', 'https://cutshort.io/jobs/android-developer-jobs'],
  ['DROP', 'https://cutshort.io/company/nagarro-software-pvt-ltd-eCQ7KMmf'],
  ['KEEP', 'https://apna.co/job/mumbai-bombay/html-email-developer-braze-sfmc-mumbai-209536785'],
  ['DROP', 'https://apna.co/jobs/dep_software_engineering-jobs'],
];
let fail = 0;
for (const [expect, url] of cases) {
  const got = isJobDetailUrl(url) ? 'KEEP' : 'DROP';
  const ok = got === expect;
  if (!ok) fail++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + got + ' ' + url);
}
console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
