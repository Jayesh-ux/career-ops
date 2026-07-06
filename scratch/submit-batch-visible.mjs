#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const PROFILE_PATH = resolve(PROJECT_ROOT, 'config/profile.yml');
const CV_PATH = resolve(PROJECT_ROOT, 'output/cv-elevenlabs.pdf'); // Canonical PDF
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'output/screenshots');

// Ensure screenshots directory exists
if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Load profile configuration
let profile = {};
try {
  profile = yaml.load(fs.readFileSync(PROFILE_PATH, 'utf8'));
} catch (e) {
  console.error(`❌ Failed to load profile.yml: ${e.message}`);
  process.exit(1);
}

const CANDIDATE = {
  fullName: profile.candidate?.full_name || 'Rohit Shankarram Jaiswar',
  firstName: (profile.candidate?.full_name || 'Rohit Jaiswar').split(' ')[0],
  lastName: (profile.candidate?.full_name || 'Rohit Jaiswar').split(' ').slice(1).join(' '),
  email: profile.candidate?.email || 'rohit.s.jaiswar@gmail.com',
  phone: profile.candidate?.phone || '8286996458',
  linkedin: profile.candidate?.linkedin || 'https://www.linkedin.com/in/rohit-jaiswar-313a60230/',
  github: profile.candidate?.github || 'https://github.com/Rohitjaiswar123',
  portfolio: profile.candidate?.portfolio_url || 'https://portfolio-next-js-chi-beryl.vercel.app/',
};

const JOBS = [
  {
    company: 'Glean',
    role: 'Associate Solutions Architect',
    url: 'https://job-boards.greenhouse.io/gleanwork/jobs/4706804005',
    type: 'greenhouse',
    location: 'Bangalore'
  },
  {
    company: 'Anthropic',
    role: 'Solutions Architect, Applied AI',
    url: 'https://job-boards.greenhouse.io/anthropic/jobs/5117581008',
    type: 'greenhouse',
    location: 'Bangalore'
  },
  {
    company: 'Celonis',
    role: 'Applied AI Engineer',
    url: 'https://job-boards.greenhouse.io/celonis/jobs/7681593003?gh_jid=7681593003',
    type: 'greenhouse',
    location: 'Remote'
  },
  {
    company: 'ElevenLabs',
    role: 'Solutions Engineer - India',
    url: 'https://jobs.ashbyhq.com/elevenlabs/fb1fd9cc-bd6d-4895-be29-4bc37d0c31a0/application',
    type: 'ashby',
    location: 'India/Remote'
  },
  {
    company: 'ElevenLabs',
    role: 'Forward Deployed Engineer',
    url: 'https://jobs.ashbyhq.com/elevenlabs/6c4c57c1-ec72-42ba-af3a-eb7aebbde2e6/application',
    type: 'ashby',
    location: 'India/Remote'
  }
];

// Helper to safely write to fields with sequence keypresses
async function typeIntoField(page, selector, value) {
  const loc = page.locator(selector).first();
  if (await loc.count() > 0 && await loc.isVisible()) {
    await loc.focus();
    await loc.fill(''); // clear
    await page.waitForTimeout(200);
    await loc.pressSequentially(value, { delay: 5 });
    await page.waitForTimeout(400);
  }
}

async function runJob(browser, job, index) {
  console.log(`\n==================================================`);
  console.log(`💼 JOB ${index + 1}/${JOBS.length}: ${job.role} at ${job.company}`);
  console.log(`📍 Location Requirement: ${job.location}`);
  console.log(`🔗 URL: ${job.url}`);
  console.log(`==================================================\n`);

  // Dynamic Location Address & Phone Determination
  let activeAddress = profile.location?.location_profiles?.mumbai?.address || 'Mumbai, India';
  let activePhone = profile.location?.location_profiles?.mumbai?.phone || CANDIDATE.phone;
  if (job.location.toLowerCase().includes('bangalore') || job.location.toLowerCase().includes('bengaluru')) {
    const bgAddress = profile.location?.location_profiles?.bangalore?.address;
    if (!bgAddress || bgAddress === 'PENDING_BANGALORE_ADDRESS') {
      console.log(`⚠️ Skipping ${job.company} - ${job.role} because it requires a Bangalore address which is not set yet.`);
      return;
    }
    activeAddress = bgAddress;
    activePhone = profile.location?.location_profiles?.bangalore?.phone || activePhone;
    console.log(`📍 Using Bangalore address: "${activeAddress}"`);
    console.log(`📞 Using Bangalore phone: "${activePhone}"`);
  } else {
    console.log(`📍 Using Mumbai address: "${activeAddress}"`);
    console.log(`📞 Using Mumbai phone: "${activePhone}"`);
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  try {
    console.log('1. Navigating to application page...');
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // If Greenhouse landing page requires clicking "Apply"
    if (job.type === 'greenhouse') {
      const applyAnchor = page.locator('a[href="#apply"], a[href="#app"], button:has-text("Apply Now"), button:has-text("Apply")').first();
      if (await applyAnchor.count() > 0 && await applyAnchor.isVisible()) {
        await applyAnchor.click();
        await page.waitForTimeout(1500);
      }
    }

    console.log('2. Filling candidate name...');
    if (job.type === 'ashby') {
      await typeIntoField(page, '[id="_systemfield_name"]', CANDIDATE.fullName);
    } else {
      const firstInput = page.locator('input[name*="first_name"], input[name*="firstName"], input[id*="first_name"], input[id*="firstName"]').first();
      if (await firstInput.count() > 0) {
        await typeIntoField(page, 'input[name*="first_name"], input[name*="firstName"], input[id*="first_name"], input[id*="firstName"]', CANDIDATE.firstName);
        await typeIntoField(page, 'input[name*="last_name"], input[name*="lastName"], input[id*="last_name"], input[id*="lastName"]', CANDIDATE.lastName);
      } else {
        await typeIntoField(page, 'input[name*="name"], input[id*="name"]', CANDIDATE.fullName);
      }
    }

    console.log('3. Filling email and phone...');
    if (job.type === 'ashby') {
      await typeIntoField(page, '[id="_systemfield_email"]', CANDIDATE.email);
    } else {
      await typeIntoField(page, 'input[type="email"], input[name*="email"], input[id*="email"]', CANDIDATE.email);
    }
    await typeIntoField(page, 'input[type="tel"], input[name*="phone"], input[name*="mobile"], input[id*="phone"], input[id*="mobile"]', activePhone);

    console.log('4. Selecting location/address...');
    if (job.type === 'ashby') {
      const locationInput = page.locator('input[placeholder="Start typing..."]').first();
      if (await locationInput.count() > 0 && await locationInput.isVisible()) {
        await locationInput.focus();
        await locationInput.fill(job.location.includes('Bangalore') ? 'Bengaluru' : 'India');
        await page.waitForTimeout(2000);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(800);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
      }
    } else {
      await typeIntoField(page, 'input[name*="location"], input[name*="city"], input[id*="location"], input[id*="city"]', activeAddress);
    }

    console.log('5. Uploading CV PDF...');
    const cvSelector = job.type === 'ashby' ? '[id="_systemfield_resume"]' : 'input[type="file"][accept*="pdf"], input[type="file"][name*="resume"], input[type="file"][id*="resume"], input[type="file"]';
    const cvInput = page.locator(cvSelector).first();
    if (await cvInput.count() > 0) {
      await cvInput.setInputFiles(CV_PATH);
      await page.waitForTimeout(3000);
    }

    console.log('6. Filling profile links (LinkedIn / GitHub / Portfolio)...');
    if (job.type === 'ashby') {
      await typeIntoField(page, '[id="e4a64e8d-f4aa-4cc5-964f-38a42480fc66"]', CANDIDATE.github);
      await typeIntoField(page, '[id="c4f15582-25b5-49d8-a22c-b994689cb957"]', CANDIDATE.linkedin);
      const sourceRadio = page.locator('input[id*="labeled-radio-2"]').first();
      if (await sourceRadio.count() > 0 && await sourceRadio.isVisible()) {
        await sourceRadio.click();
        await page.waitForTimeout(800);
      }
    } else {
      // Greenhouse standard link fields
      await typeIntoField(page, 'input[name*="linkedin"], input[id*="linkedin"], label:has-text("LinkedIn") + input', CANDIDATE.linkedin);
      await typeIntoField(page, 'input[name*="github"], input[id*="github"], label:has-text("GitHub") + input', CANDIDATE.github);
      await typeIntoField(page, 'input[name*="portfolio"], input[name*="website"], input[id*="portfolio"], label:has-text("Portfolio") + input', CANDIDATE.portfolio);
    }

    // Fill ElevenLabs essay questions if Ashby FDE / Solutions
    if (job.company === 'ElevenLabs') {
      console.log('7. Filling ElevenLabs custom essay questions...');
      const ANSWERS = {
        why: `I have been following ElevenLabs' breakthroughs in synthetic media, voice translation, and developer tools. As a developer who has integrated AI APIs (like Gemini in ClockHustle) to build real-world user value, I am fascinated by ElevenLabs' research-backed deployment speed and developer-first ecosystem (ElevenAgents, ElevenAPI). ElevenLabs is leading the voice AI space, and I want to be part of the engineering team that brings these capabilities to APAC developers and partners.`,
        impactful: `The most impactful thing I have built is ClockHustle (clockhustle.com), an AI-powered scope creep detection SaaS. I was the sole founder and full-stack developer. I architected the application with a Next.js frontend and a Firebase backend, and integrated Gemini AI. The core value is that it automates 30% of project scope creep detection, reducing manual audit time for freelance developers and small software teams.`,
        success: `Success looked like users saving hours of manual audit time. By automating 30% of scope creep detection, our users (primarily freelancers and team managers) reported a significant reduction in the time spent manually reviewing project requirement updates and client messages. The platform successfully calculated metrics, parsed scopes, and generated alerts with low latency.`,
        product: `Yes! I have experimented with ElevenLabs' text-to-speech API in personal projects to explore voice cloning and dynamic audio generation. I have used your developer documentation to generate high-fidelity audio streams and explored how ElevenAgents can be used for voice-based agentic workflows.`
      };

      await typeIntoField(page, '[id="29e8435d-6a3d-4cd4-91b4-8e82afa0c1f3"]', ANSWERS.why);
      await typeIntoField(page, '[id="94b85326-2bf1-445f-ab41-7f2d316ca9f8"]', ANSWERS.impactful);
      await typeIntoField(page, '[id="832af6e6-f4c6-49de-b4d6-e6d3c7041863"]', ANSWERS.success);
      await typeIntoField(page, '[id="81600888-8c3f-43e6-a3cf-13d5166f5f6c"]', ANSWERS.product);
    }

    // Scroll down to the end
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Auto-click legal consent checkboxes on Greenhouse
    if (job.type === 'greenhouse') {
      console.log('8. Selecting legal consent checkboxes...');
      const checkboxes = page.locator('input[type="checkbox"]');
      const count = await checkboxes.count();
      for (let i = 0; i < count; i++) {
        const text = await checkboxes.nth(i).locator('xpath=..').innerText().catch(() => '');
        if (text.toLowerCase().includes('authorized to work') || 
            text.toLowerCase().includes('consent') || 
            text.toLowerCase().includes('agree') || 
            text.toLowerCase().includes('privacy policy') ||
            text.toLowerCase().includes('data protection')) {
          await checkboxes.nth(i).check().catch(() => {});
          await page.waitForTimeout(400);
        }
      }
    }

    console.log('9. Attempting to click Submit button...');
    const submitBtn = page.locator('button:has-text("Submit Application"), button:has-text("Submit"), button[type="submit"]').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await submitBtn.click();
    console.log('   Submit button clicked! Waiting 10 seconds to verify outcome...');
    await page.waitForTimeout(10000);

    // Capture visual outcome screenshot
    const screenshotPath = resolve(SCREENSHOT_DIR, `${index + 1}-${job.company.toLowerCase()}-${job.role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`📸 Outcome screenshot saved: ${screenshotPath}`);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes('limiting applications') || bodyText.includes('cannot submit') || bodyText.includes('error') || bodyText.includes('invalid')) {
      console.log(`❌ Submission blocked or errored on ${job.company} portal.`);
    } else {
      console.log(`✅ ${job.company} application sequential stage completed!`);
    }

  } catch (err) {
    console.error(`❌ Error executing application for ${job.company}: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  console.log('🚀 Starting Sequential Autopilot Application Suite...');
  console.log(`👤 Candidate: ${CANDIDATE.fullName} (${CANDIDATE.email})`);
  console.log(`📂 CV PDF: ${CV_PATH}`);
  console.log(`📸 Screenshots directory: ${SCREENSHOT_DIR}\n`);

  const isHeadless = process.argv.includes('--headless');
  console.log(`🖥️  Browser Mode: ${isHeadless ? 'Headless (Background)' : 'Headed (Visible)'}`);
  const browser = await chromium.launch({ headless: isHeadless });

  for (let i = 0; i < JOBS.length; i++) {
    await runJob(browser, JOBS[i], i);
    console.log('\n⏱️ Pacing delay: waiting 5 seconds before starting next application...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log('\n🎉 Sequential batch run finished! Closing browser.');
  await browser.close().catch(() => {});
}

main().catch(console.error);
