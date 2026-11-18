import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function searchJobs() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  
  const queries = [
    { title: 'Full Stack Developer', loc: 'Hyderabad, Telangana' },
    { title: 'React Developer', loc: 'Gachibowli, Hyderabad' },
    { title: 'Node.js Developer', loc: 'HITEC City, Hyderabad' },
    { title: 'Software Engineer MERN', loc: 'Hyderabad, Telangana' }
  ];

  const results = [];

  for (const q of queries) {
    const url = `https://in.indeed.com/jobs?q=${encodeURIComponent(q.title)}&l=${encodeURIComponent(q.loc)}`;
    console.log(`Navigating to ${url}...`);
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);

      const jobs = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.job_seen_beacon, .result, [data-jk], .jobCard'));
        return cards.map(card => {
          const titleElem = card.querySelector('h2.jobTitle span, a[id^="job_"] span, h2 span');
          const companyElem = card.querySelector('[data-testid="company-name"], .companyName');
          const locElem = card.querySelector('[data-testid="text-location"], .companyLocation');
          const linkElem = card.querySelector('h2.jobTitle a, a[id^="job_"]');
          const snippetElem = card.querySelector('.job-snippet, .underline');
          
          return {
            title: titleElem ? titleElem.innerText.trim() : '',
            company: companyElem ? companyElem.innerText.trim() : '',
            location: locElem ? locElem.innerText.trim() : '',
            link: linkElem ? (linkElem.href.startsWith('http') ? linkElem.href : 'https://in.indeed.com' + linkElem.getAttribute('href')) : '',
            snippet: snippetElem ? snippetElem.innerText.trim() : ''
          };
        }).filter(j => j.title && j.company);
      });

      console.log(`Found ${jobs.length} jobs for ${q.title} in ${q.loc}`);
      results.push(...jobs);
    } catch (err) {
      console.error(`Error searching ${q.title}:`, err.message);
    }
  }

  // Deduplicate
  const uniqueJobs = [];
  const seen = new Set();
  for (const j of results) {
    const key = `${j.company.toLowerCase()}_${j.title.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueJobs.push(j);
    }
  }

  console.log(`Total unique jobs found: ${uniqueJobs.length}`);

  // Inspect details of top 20 jobs for phone numbers / email contact / direct details
  const detailedJobs = [];
  for (let i = 0; i < Math.min(uniqueJobs.length, 25); i++) {
    const job = uniqueJobs[i];
    if (!job.link) continue;
    try {
      console.log(`Checking details [${i+1}/${Math.min(uniqueJobs.length, 25)}]: ${job.title} at ${job.company}`);
      await page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);
      
      const details = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        
        // Regex for phone numbers in Indian job listings (mobile, landline, WhatsApp)
        const phoneRegex = /(?:\+?91[\s-]?)?[6-9]\d{9}|\b0\d{2,4}[\s-]?\d{6,8}\b/g;
        const rawPhones = bodyText.match(phoneRegex) || [];
        // Filter out false positives (dates, long IDs)
        const phones = Array.from(new Set(rawPhones)).filter(p => {
          const digits = p.replace(/\D/g, '');
          return digits.length >= 10 && digits.length <= 12;
        });

        // Email regex
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const rawEmails = bodyText.match(emailRegex) || [];
        const emails = Array.from(new Set(rawEmails)).filter(e => 
          !e.endsWith('.png') && !e.endsWith('.jpg') && !e.includes('indeed') && !e.includes('w3.org') && !e.includes('schema.org')
        );

        return {
          fullText: bodyText.slice(0, 3000),
          phones,
          emails
        };
      });

      detailedJobs.push({
        ...job,
        phones: details.phones,
        emails: details.emails,
        descriptionSample: details.fullText
      });
    } catch (e) {
      console.error(`Error detailing ${job.title}: ${e.message}`);
      detailedJobs.push(job);
    }
  }

  const outputPath = path.join(process.cwd(), 'output', 'indeed_jobs_hyderabad.json');
  fs.mkdirSync(path.join(process.cwd(), 'output'), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(detailedJobs, null, 2));
  console.log(`Saved results to ${outputPath}`);

  await browser.close();
}

searchJobs().catch(console.error);
