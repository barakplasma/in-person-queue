const { firefox } = require('playwright');
const expect = require('expect');

const userIdSelector = '#userId';
const queueLengthSelector = '#queueLengthCount';
const locationSelector = '#location > a:nth-child(1)';

describe('Admin page', () => {
  let browser, page, context;
  beforeAll(async () => {
    browser = await firefox.launch({
      headless: true
    });
    context = await browser.newContext();
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 59.95, longitude: 30.31667 });

    // Open new page
    page = await context.newPage();

    // Go to http://localhost:6363/
    await page.goto('http://localhost:6363/');

    await page.evaluate(() => {
      window.localStorage.setItem('env', 'test');
      window.localStorage.setItem('test host', 'localhost:6363');
    });

    await page.reload();

    // Click 'Create a new queue at my current location']
    await page.click('//button[normalize-space(.)=\'Create a new queue at my current location\']');

    // await page.waitForTimeout(50000)
  })
  afterAll(async () => {
    // Close page
    await page.close();
    await context.close();
    await browser.close();
  })
  describe('should have correct start up elements', () => {
    it('should have user id', async () => {
      await page.waitForSelector(userIdSelector);
      await page.waitForFunction((userIdSelector) => {
        return document.querySelector(userIdSelector).innerHTML.includes('Start')
      }, userIdSelector, { timeout: 1000 })
      const currentUser = await page.innerText(userIdSelector);
      expect(currentUser).toBe("Start Queue");
    })
    it('should have right queue length', async () => {

      // Check for admin page to have the right queue length
      await page.waitForSelector(queueLengthSelector);
      const queueLength = await page.innerText(queueLengthSelector);
      expect(queueLength).toBe("1");
    })

    it('should have the right location', async () => {
      // Check admin page for location
      await page.waitForSelector(locationSelector);
      const location = await page.innerText(locationSelector);
      expect(location).toBe("9GFGX828+2M")
    })
  })
})