const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });

  const page = await ctx.newPage();

  await page.goto('https://www.naukri.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log('Homepage loaded');

  // Click Login button
  const loginBtn = await page.$('#login_Layer');
  if (!loginBtn) {
    console.log('ERROR: Login button (#login_Layer) not found');
    await page.screenshot({ path: '/tmp/naukri-nologinbtn.png' });
    await browser.close();
    process.exit(1);
  }

  console.log('Clicking Login...');
  await loginBtn.click();
  await page.waitForTimeout(5000);

  console.log('URL after login click:', page.url());

  // Wait for login form to appear (might be in a modal/overlay or new page)
  const emailField = await page.$('#usernameField');
  const passField = await page.$('#passwordField');

  if (!emailField || !passField) {
    console.log('Form fields not found on current page. Checking for modal/iframe...');
    // Check if there's a modal or iframe
    const iframes = page.frames();
    console.log(`Frames: ${iframes.length}`);
    for (const f of iframes) {
      const url = f.url();
      console.log(`  Frame URL: ${url}`);
      if (url.includes('login')) {
        const email = await f.$('#usernameField');
        if (email) {
          console.log('Found login form in iframe!');
          await email.click();
          await email.fill('hsinghjayesh@gmail.com');
          const pass = await f.$('#passwordField');
          await pass.click();
          await pass.fill('28_Jayesh_Singh');
          const sub = await f.$('button[type="submit"]');
          await sub.click();
          await page.waitForTimeout(10000);
          break;
        }
      }
    }
    await page.screenshot({ path: '/tmp/naukri-modal.png' });
    console.log('Check screenshot: /tmp/naukri-modal.png');
  } else {
    console.log('Filling credentials...');
    await emailField.fill('hsinghjayesh@gmail.com');
    await passField.fill('28_Jayesh_Singh');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    }
  }

  await page.waitForTimeout(10000);
  console.log('Post-login URL:', page.url());

  const bodyText = await page.textContent('body');

  if (page.url().includes('my.naukri') || bodyText.toLowerCase().includes('logout')) {
    console.log('*** LOGIN SUCCESS ***');

    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);

    const desigInput = await page.$('input[placeholder="Designation"], input[placeholder*="designation" i], input[placeholder*="Designation" i]');
    if (desigInput) {
      const currVal = await desigInput.inputValue();
      console.log(`Current designation: "${currVal}"`);
      await desigInput.click();
      await desigInput.fill('');
      await page.waitForTimeout(200);
      await desigInput.fill('Full Stack Developer');
      console.log('Updated to: Full Stack Developer');

      // Look for save/update button
      const saveBtn = await page.$('button:has-text("Save"), button:has-text("Update")');
      if (saveBtn) {
        await saveBtn.click();
        await page.waitForTimeout(3000);
        console.log('Saved!');
      }
    } else {
      console.log('Designation input not found directly. Dumping inputs...');
      const inputs = await page.$$eval('input', els => els.map(e => ({ ph: e.placeholder, nm: e.name, id: e.id, val: (e.value || '').substring(0,30) })));
      inputs.slice(0, 20).forEach((inp, i) => console.log(`  ${i}: ${JSON.stringify(inp)}`));
    }

    await page.screenshot({ path: '/tmp/naukri-final.png', fullPage: true });
    console.log('Final screenshot: /tmp/naukri-final.png');

  } else if (bodyText.includes('OTP') || bodyText.includes('otp')) {
    console.log('*** OTP CHALLENGE ***');
    await page.screenshot({ path: '/tmp/naukri-otp.png' });
  } else {
    console.log('*** UNKNOWN LOGIN STATE ***');
    console.log('Body:', bodyText.substring(0, 1000));
    await page.screenshot({ path: '/tmp/naukri-unknown.png' });
  }

  await browser.close();
  console.log('Done.');
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
