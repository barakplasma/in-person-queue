const { chromium } = require('playwright');

async function setupE2E() {
  let browser = await chromium.launch({
    headless: false
  });
  let context = await browser.newContext();
  await context.grantPermissions(['geolocation']);

  // Open new page
  let page = await context.newPage();

  // Go to localhost start page
  await page.goto('http://localhost:6363/');

  await page.evaluate(() => {
    window.localStorage.setItem('env', 'test');
    window.localStorage.setItem('test host', 'localhost:6363');
  });

  await page.reload();

  async function shutdownE2E() {
    // Close page
    await page.close();
    await context.close();
    await browser.close();
  }

  return { browser, page, context, shutdownE2E };
}

module.exports = {
  setupE2E,
}