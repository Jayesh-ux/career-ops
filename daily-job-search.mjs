#!/usr/bin/env node
/**
 * daily-job-search.mjs — Daily Mumbai auto-apply pipeline
 *
 * Strategy:
 * 1. Run scan.mjs for ATS-tracked companies (Greenhouse/Lever/Ashby)
 * 2. Check specific Indian company career pages via Playwright
 * 3. Search curated job boards via fetch
 * 4. Generate .eml files for email-based applications
 * 5. Auto-submit on accessible portals
 *
 * Usage:
 *   node daily-job-search.mjs              # full run
 *   node daily-job-search.mjs --dry-run    # search only
 *   node daily-job-search.mjs --scan       # scan + search only
 */

import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const SCAN_ONLY = process.argv.includes('--scan');
const PDF_PATH = resolve(__dirname, 'data/users/hsinghjayesh@gmail.com/output/current-resume.pdf');
const LOG_FILE = resolve(__dirname, 'data/daily-job-log.md');
const PIPELINE_FILE = resolve(__dirname, 'data/pipeline.md');
const OUT_DIR = resolve(__dirname, 'output');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(resolve(__dirname, 'batch/tracker-additions'), { recursive: true });

const CANDIDATE = {
  name: 'Jayesh Singh',
  email: 'hsinghjayesh@gmail.com',
  phone: '+91-7821816193',
  location: 'Kalyan, Mumbai',
  stacks: ['React', 'Next.js', 'Node.js', 'Python', 'Java', 'Spring Boot', 'Django', 'PostgreSQL', 'AWS'],
  target: 'Full Stack Developer / Software Engineer',
  salary: '3-6 LPA',
};

// Active job URLs to check for availability + new postings
const COMPANY_PAGES = [
  { name: 'Ingram Micro India', url: 'https://careers.ingrammicro.com/en/locations/apac/india/' },
  { name: 'TCS Freshers', url: 'https://www.tcs.com/careers/india/freshers' },
  { name: 'Infosys Freshers', url: 'https://www.infosys.com/careers/freshers.html' },
  { name: 'Wipro Freshers', url: 'https://careers.wipro.com/careers-home/' },
  { name: 'Accenture India Freshers', url: 'https://www.accenture.com/in-en/careers/jobsearch?jk=fresher' },
  { name: 'Cognizant Freshers', url: 'https://careers.cognizant.com/global-en/freshers/' },
  { name: 'LTIMindtree', url: 'https://www.ltimindtree.com/careers/' },
  { name: 'Tech Mahindra', url: 'https://careers.techmahindra.com/' },
  { name: 'HCL Freshers', url: 'https://www.hcltech.com/careers/freshers' },
  { name: 'Capgemini Freshers', url: 'https://www.capgemini.com/in-en/careers/freshers/' },
];

// Read tracker to skip already-applied companies
function getAppliedCompanies() {
  try {
    const tracker = readFileSync(resolve(__dirname, 'data/applications.md'), 'utf-8');
    const companies = [];
    const lines = tracker.split('\n');
    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 7 && /^\d+$/.test(parts[1])) {
        const status = parts[5];
        const company = parts[2];
        if (status && status.toLowerCase() === 'applied') companies.push(company.toLowerCase());
      }
    }
    return [...new Set(companies)];
  } catch { return []; }
}

// New companies to explore (NOT in tracker yet)
function getNewTargets(appliedCompanies) {
  const candidates = [
    {
      company: 'The Red Arc',
      to: 'wecare@theredarc.com',
      subject: 'Application for Full Stack Developer',
      role: 'Full Stack Developer',
      location: 'Mumbai/Remote',
    },
    {
      company: 'Scalix Enterprise Solution LLP',
      to: 'sales@scalix.in',
      subject: 'Application for Fresher Software Engineer',
      role: 'Fresher Software Engineer',
      location: 'Dahisar Mumbai',
    },
    {
      company: 'Verdantis Technologies',
      to: 'careers@verdantis.com',
      subject: 'Application for Full Stack Developer Intern',
      role: 'Full Stack Developer Intern',
      location: 'Andheri East Mumbai',
    },
    {
      company: 'NeoSOFT Technologies',
      to: 'jobs@neosofttech.com',
      subject: 'Application for Software Engineer',
      role: 'Software Engineer',
      location: 'Mumbai',
    },
    {
      company: 'Lofaz',
      to: 'info@lofaz.com',
      subject: 'Application for Full Stack Development Internship',
      role: 'Full Stack Development Intern',
      location: 'Mumbai',
    },
    {
      company: 'OLV Technologies',
      to: 'careers@olv.global',
      subject: 'Application for Full Stack Development Internship',
      role: 'Full Stack Development Intern',
      location: 'Mumbai',
    },
    {
      company: 'Pillow Tax',
      to: 'contact@pillowtax.com',
      subject: 'Application for Full Stack Development Internship',
      role: 'Full Stack Development Intern',
      location: 'Mumbai',
    },
    {
      company: 'Cere Labs',
      to: 'contact@cerelabs.com',
      subject: 'Application for Software Developer Fresher',
      role: 'Software Developer Fresher',
      location: 'Mulund Mumbai',
    },
    {
      company: 'Systenics Solutions',
      to: 'jobs@systenics.com',
      subject: 'Application for Trainee Software Developer',
      role: 'Trainee Software Developer',
      location: 'Sanpada Navi Mumbai',
    },
    {
      company: 'Advin Softwares',
      to: 'info@advinsoftwares.com',
      subject: 'Application for Fresher Software Developer',
      role: 'Fresher Software Developer',
      location: 'CBD Belapur Navi Mumbai',
    },
    {
      company: 'LvlUp Labz',
      to: 'careers@lvluplabz.dev',
      subject: 'Application for Junior Full-Stack Developer',
      role: 'Junior Full-Stack Developer',
      location: 'Mumbai',
    },
    {
      company: 'SequelString AI',
      to: 'careers@sequelstring.com',
      subject: 'Application for AI/ML Intern',
      role: 'AI/ML Intern',
      location: 'Mulund Mumbai',
    },
    {
      company: 'Green Pista',
      to: 'hr@greenpista.com',
      subject: 'Application for Frontend Development Intern',
      role: 'Frontend Development Intern',
      location: 'Mumbai',
    },
  ];

  return candidates.filter(c => !appliedCompanies.includes(c.company.toLowerCase()));
}

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${ts}] ${msg}`);
}

function generateEml(app) {
  const boundary = `==boundary_${Date.now()}_${Math.random().toString(36).slice(2)}==`;
  const body = `Dear Hiring Team,

I am writing to apply for the ${app.role} position at ${app.company}. I am a Full Stack Developer with experience building production web applications using React.js, Next.js, Node.js, Python, Java, Spring Boot, and PostgreSQL.

During my internship at Qyuki Digital Media and through my solo projects (Fair Pay Solution, Career Grid), I have delivered full-stack applications end-to-end — from REST API design and database architecture to cloud deployment on AWS.

Key highlights:
- Built a loan settlement platform (fairpaysolution.com) with Supabase, Razorpay payments, Google OAuth, and RBAC
- Developed Career Grid job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and available for on-site work${app.location ? ` at ${app.location}` : ' in the Mumbai area'}.

My resume is attached for your reference.

Best regards,
Jayesh Singh
${CANDIDATE.email} | ${CANDIDATE.phone}
github.com/Jayesh-ux | linkedin.com/in/jayesh-dev`;

  let eml = `From: Jayesh Singh <${CANDIDATE.email}>\r\nTo: ${app.to}\r\n`;
  if (app.cc) eml += `Cc: ${app.cc}\r\n`;
  eml += `Subject: ${app.subject}\r\n`;
  eml += `MIME-Version: 1.0\r\n`;
  eml += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
  eml += `--${boundary}\r\n`;
  eml += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
  eml += body + '\r\n\r\n';

  if (existsSync(PDF_PATH)) {
    const b64 = readFileSync(PDF_PATH).toString('base64');
    eml += `--${boundary}\r\n`;
    eml += `Content-Type: application/pdf\r\n`;
    eml += `Content-Disposition: attachment; filename="Jayesh_Singh_CV.pdf"\r\n`;
    eml += `Content-Transfer-Encoding: base64\r\n\r\n`;
    for (let i = 0; i < b64.length; i += 76) {
      eml += b64.slice(i, i + 76) + '\r\n';
    }
    eml += `\r\n--${boundary}--\r\n`;
  }

  const safeName = app.company.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const filename = `${safeName}-${new Date().toISOString().split('T')[0]}.eml`;
  writeFileSync(resolve(OUT_DIR, filename), eml);
  return filename;
}

async function checkCompanyPages() {
  log('🏢 Checking company career pages...');
  const results = [];

  for (const company of COMPANY_PAGES) {
    try {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(company.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const text = await page.locator('body').innerText().catch(() => '');
      const url = page.url();
      
      // Check if still accepting applications
      const hasApply = text.toLowerCase().includes('apply') || 
                       text.toLowerCase().includes('apply now') ||
                       text.toLowerCase().includes('submit') || 
                       text.toLowerCase().includes('register') ||
                       text.toLowerCase().includes('sign in');
      
      const isExpired = text.toLowerCase().includes('no longer') || 
                        text.toLowerCase().includes('expired') || 
                        text.toLowerCase().includes('closed') ||
                        text.toLowerCase().includes('not found');

      results.push({
        company: company.name,
        url: company.url,
        active: hasApply && !isExpired,
        role: company.role || 'N/A',
        redirected: url !== company.url,
      });

      log(`  ${company.name}: ${hasApply && !isExpired ? '✅ Active' : '❌ Inactive'}${url !== company.url ? ' (redirected)' : ''}`);
      await browser.close();
    } catch (err) {
      log(`  ⚠️ ${company.name}: ${err.message}`);
      results.push({ company: company.name, url: company.url, active: false, role: company.role, error: err.message });
    }
  }

  return results;
}

async function runScan() {
  log('📡 Running ATS scanner...');
  try {
    const output = execSync('node scan.mjs 2>&1', { 
      timeout: 120000, 
      cwd: __dirname,
      encoding: 'utf-8',
    });
    log(output.split('\n').slice(-10).join('\n'));
    return output;
  } catch (err) {
    log(`⚠️ Scan error: ${err.message}`);
    return null;
  }
}

async function generateEmailApps() {
  log('\n📧 Generating email applications...');
  const files = [];
  const appliedCompanies = getAppliedCompanies();
  const targets = getNewTargets(appliedCompanies);

  log(`  📋 ${targets.length} new companies found (${appliedCompanies.length} already applied)`);

  for (const app of targets) {
    try {
      const filename = generateEml(app);
      files.push(filename);
      log(`  ✅ ${app.company}: ${filename}`);
    } catch (err) {
      log(`  ❌ ${app.company}: ${err.message}`);
    }
  }

  if (targets.length === 0) {
    log('  ✅ No new companies to apply to. All targets already applied.');
  }

  return files;
}

async function updatePipeline(companyPages, scanResults) {
  const entries = [];

  // Add active companies
  for (const page of companyPages) {
    if (page.active) {
      entries.push(`- [ ] ${page.url} | ${page.company} | ${page.role} | Mumbai`);
    }
  }

  // Parse scan results for new India-based roles
  if (scanResults) {
    const indiaMatches = scanResults.match(/(IND|India|Mumbai|Bengaluru|Hyderabad|Chennai|Pune)/gi);
    if (indiaMatches) {
      entries.push(`- [ ] scan:auto | ${new Date().toISOString().split('T')[0]} | Auto-scanned India roles`);
    }
  }

  if (entries.length > 0) {
    let pipeline = existsSync(PIPELINE_FILE) ? readFileSync(PIPELINE_FILE, 'utf-8') : '# Pipeline\n\n## Pending\n\n## Processed\n';
    
    for (const entry of entries) {
      if (pipeline.includes('## Pending')) {
        const lastPending = pipeline.lastIndexOf('## Pending');
        const before = pipeline.slice(0, lastPending + 11);
        const after = pipeline.slice(lastPending + 11);
        pipeline = before + '\n' + entry + after;
      }
    }
    
    writeFileSync(PIPELINE_FILE, pipeline);
    log(`📝 Pipeline: ${entries.length} entries added`);
  }
}

async function logSummary(companyPages, emlFiles) {
  const today = new Date().toISOString().split('T')[0];
  const summary = [
    `\n## Daily Search — ${today}`,
    `**Time:** ${new Date().toISOString()}`,
    `**Mode:** ${DRY_RUN ? 'DRY RUN' : 'FULL'}\n`,
    `### Company Pages Checked`,
    ...companyPages.map(p => `- ${p.company}: ${p.active ? '✅ Active' : '❌ Inactive/Expired'}${p.redirected ? ' (redirected)' : ''}`),
    `\n### New Applications Generated (${emlFiles.length})`,
    ...emlFiles.map(f => `- ✅ ${f}`),
    `\n### Already Applied (skipped from re-apply)`,
    ...getAppliedCompanies().map(c => `- ${c}`),
    '\n---\n',
  ].join('\n');

  appendFileSync(LOG_FILE, summary);
}

async function main() {
  const startTime = Date.now();
  log('🚀 ===== DAILY JOB AUTO-APPLY =====\n');

  // Step 1: Check company pages
  const companyPages = await checkCompanyPages();
  
  // Step 2: Run ATS scan
  const scanOutput = await runScan();
  
  // Step 3: Update pipeline
  await updatePipeline(companyPages, scanOutput);
  
  // Step 4: Generate email applications (unless dry run)
  let emlFiles = [];
  if (!DRY_RUN && !SCAN_ONLY) {
    emlFiles = await generateEmailApps();
  }

  // Step 5: Log everything
  await logSummary(companyPages, emlFiles);
  
  // Step 6: Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n📊 ===== DONE in ${elapsed}s =====`);
  log(`Companies checked: ${companyPages.length}`);
  log(`Pipeline updates: ${companyPages.filter(p => p.active).length} active`);
  log(`Emails generated: ${emlFiles.length}`);
  
  const activeCompanies = companyPages.filter(p => p.active).map(p => p.company).join(', ');
  if (activeCompanies) log(`Active: ${activeCompanies}`);
  log(`Log: data/daily-job-log.md`);
  log(`===============================`);
  
  if (emlFiles.length > 0) {
    log(`\n📧 To send: open output/*.eml on your phone → Gmail → Send`);
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
