const { chromium } = require('playwright');
let queue = require('../../queue/queue');
let process = require('process');
let port = process.env.PORT || '3000';

async function setupE2E() {
  await setupDB();
  let browser = await chromium.launch({
    headless: true,
  });
  let context = await browser.newContext();
  await context.setGeolocation({ latitude: 60.95, longitude: 30.31667 });
  await context.grantPermissions(['geolocation']);

  // Open new page
  let page = await context.newPage();

  // Go to localhost start page
  await page.goto(`http://localhost:${port}/`);

  let pageCommand = `window.localStorage.setItem('env', 'test');window.localStorage.setItem('test host', 'localhost:${port}');`

  await page.evaluate(pageCommand);

  await page.reload({waitUntil: 'networkidle'});

  async function shutdownE2E() {
    // Close page
    await page.close();
    await context.close();
    await browser.close();
  }

  return { browser, page, context, shutdownE2E };
}

async function waitForRedis() {
  if (queue._redis.status !== 'ready') {
    // console.debug(queue._redis.status);
    await new Promise(resolve => queue._redis.on('ready', resolve));
  }
}

async function setupDB() {
  await waitForRedis();
  // "OUdHR1g4MjgrMk0="
  await queue.createQueue('q:9GGGX828+2M', 'password');
}

async function cleanDB() {
  await waitForRedis();

  await queue._redis.flushall();
}

module.exports = {
  waitForRedis,
  setupE2E,
  setupDB,
  cleanDB
}