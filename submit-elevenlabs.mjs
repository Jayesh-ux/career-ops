#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CV_PATH = resolve(__dirname, 'output/cv-elevenlabs.pdf');

const CANDIDATE = {
  name: 'Rohit Shankarram Jaiswar',
  email: 'rohit.s.jaiswar@gmail.com',
  phone: '8286996458',
  linkedin: 'https://www.linkedin.com/in/rohit-jaiswar-313a60230/',
  github: 'https://github.com/Rohitjaiswar123',
  portfolio: 'https://portfolio-next-js-chi-beryl.vercel.app/',
};

// Precise Answers based on Rohit's profile context
const ANSWERS = {
  whyElevenLabs: `I have been following ElevenLabs' breakthroughs in synthetic media, voice translation, and developer tools. As a developer who has integrated AI APIs (like Gemini in ClockHustle) to build real-world user value, I am fascinated by ElevenLabs' research-backed deployment speed and developer-first ecosystem (ElevenAgents, ElevenAPI). ElevenLabs is leading the voice AI space, and I want to be part of the engineering team that brings these capabilities to APAC developers and partners.`,
  
  impactfulThing: `The most impactful thing I have built is ClockHustle (clockhustle.com), an AI-powered scope creep detection SaaS. I was the sole founder and full-stack developer. I architected the application with a Next.js frontend and a Firebase backend, and integrated Gemini AI. The core value is that it automates 30% of project scope creep detection, reducing manual audit time for freelance developers and small software teams.`,
  
  howItWorked: `Success looked like users saving hours of manual audit time. By automating 30% of scope creep detection, our users (primarily freelancers and team managers) reported a significant reduction in the time spent manually reviewing project requirement updates and client messages. The platform successfully calculated metrics, parsed scopes, and generated alerts with low latency.`,
  
  usedProduct: `Yes! I have experimented with ElevenLabs' text-to-speech API in personal projects to explore voice cloning and dynamic audio generation. I have used your developer documentation to generate high-fidelity audio streams and explored how ElevenAgents can be used for voice-based agentic workflows.`
};

const JOBS = {
  fde: {
    title: 'Forward Deployed Engineer - Software Engineer',
    url: 'https://jobs.ashbyhq.com/elevenlabs/6c4c57c1-ec72-42ba-af3a-eb7aebbde2e6/application',
  },
  solutions: {
    title: 'Solutions Engineer',
    url: 'https://jobs.ashbyhq.com/elevenlabs/fb1fd9cc-bd6d-4895-be29-4bc37d0c31a0/application',
  }
};

async function applyToRole(key) {
  const job = JOBS[key];
  if (!job) {
    console.error(`Invalid job key: ${key}`);
    return;
  }

  console.log(`\n🚀 Starting visible auto-fill for: ${job.title}`);
  console.log(`🔗 URL: ${job.url}`);

  if (!existsSync(CV_PATH)) {
    console.error(`❌ CV PDF not found at: ${CV_PATH}. Run 'node generate-pdf.mjs templates/cv-template.html output/cv-elevenlabs.pdf' first.`);
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  try {
    console.log('1. Navigating to Ashby form page...');
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Helper to safely write to fields with sequence keypresses
    async function typeIntoField(selector, value) {
      const loc = page.locator(selector).first();
      await loc.waitFor({ state: 'visible', timeout: 10000 });
      await loc.focus();
      await loc.fill(''); // clear
      await page.waitForTimeout(200);
      await loc.pressSequentially(value, { delay: 5 });
      await page.waitForTimeout(500);
    }

    // Fill Full Name
    console.log('2. Filling Name...');
    await typeIntoField('[id="_systemfield_name"]', CANDIDATE.name);

    // Fill Email
    console.log('3. Filling Email...');
    await typeIntoField('[id="_systemfield_email"]', CANDIDATE.email);

    // Fill Location (Autocomplete)
    console.log('4. Filling Location...');
    const locationInput = page.locator('input[placeholder="Start typing..."]').first();
    await locationInput.waitFor({ state: 'visible', timeout: 10000 });
    await locationInput.focus();
    await locationInput.fill('India');
    await page.waitForTimeout(2000);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Upload CV
    console.log('5. Uploading CV PDF...');
    const fileInput = page.locator('[id="_systemfield_resume"]');
    await fileInput.setInputFiles(CV_PATH);
    await page.waitForTimeout(3000);

    // Fill GitHub
    console.log('6. Filling GitHub Profile...');
    await typeIntoField('[id="e4a64e8d-f4aa-4cc5-964f-38a42480fc66"]', CANDIDATE.github);

    // Fill LinkedIn
    console.log('7. Filling LinkedIn Profile...');
    await typeIntoField('[id="c4f15582-25b5-49d8-a22c-b994689cb957"]', CANDIDATE.linkedin);

    // Select "Job board" for "How did you hear about this job?"
    console.log('8. Selecting source channel...');
    const radioBtn = page.locator('input[id*="labeled-radio-2"]').first();
    if (await radioBtn.isVisible()) {
      await radioBtn.click();
      await page.waitForTimeout(1500);
    }

    // Fill Custom Questions
    console.log('9. Answering "Why ElevenLabs"...');
    await typeIntoField('[id="29e8435d-6a3d-4cd4-91b4-8e82afa0c1f3"]', ANSWERS.whyElevenLabs);

    console.log('10. Answering "Most impactful thing built"...');
    await typeIntoField('[id="94b85326-2bf1-445f-ab41-7f2d316ca9f8"]', ANSWERS.impactfulThing);

    console.log('11. Answering "How did you know it worked"...');
    await typeIntoField('[id="832af6e6-f4c6-49de-b4d6-e6d3c7041863"]', ANSWERS.howItWorked);

    console.log('12. Answering "Have you used ElevenLabs"...');
    await typeIntoField('[id="81600888-8c3f-43e6-a3cf-13d5166f5f6c"]', ANSWERS.usedProduct);

    console.log('\n👀 ================= MANUAL REVIEW REQUIRED =================');
    console.log('   Form has been auto-filled. Please check the browser window.');
    console.log('   Once satisfied, click Submit/Apply on the webpage.');
    console.log('   Press CTRL+C in this terminal when you are done to close.');
    console.log('   ===========================================================');

    // Keep browser open indefinitely for manual review and submit
    await new Promise(() => {});

  } catch (e) {
    console.error(`❌ Playwright error: ${e.message}`);
  } finally {
    // DO NOT CLOSE browser immediately on error so user can inspect it
    await page.waitForTimeout(120_000);
    await browser.close().catch(() => {});
  }
}

async function main() {
  const role = process.argv[2];
  if (role === 'fde') {
    await applyToRole('fde');
  } else if (role === 'solutions') {
    await applyToRole('solutions');
  } else {
    console.log(`
Usage:
  node submit-elevenlabs.mjs fde        # Open FDE role application page
  node submit-elevenlabs.mjs solutions  # Open Solutions Engineer role application page
`);
  }
}

main();
