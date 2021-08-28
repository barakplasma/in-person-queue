const {setupE2E, cleanDB, setupDB} = require('./sharedE2E');
const expect = require('expect');
const teardown = require('./teardown');

const userIdSelector = '#userId';
const queueLengthSelector = '#queueLengthCount';
const locationSelector = '#location';
const submitAdminMessageSelector = '#submit-admin-message';

const userPageAdminMessageSelector = '#admin-message';

describe('Admin page', () => {
  const e2e = setupE2E();
  /**
   * @type {import('playwright').Page} page
   */
  let page;

  /**
   * @type {import('playwright').BrowserContext} page
   */
  let context;

  beforeAll(async () => {
    await setupDB();
    page = (await e2e).page;
    context = (await e2e).context;

    await context.setGeolocation({latitude: 59.95 + Math.random(), longitude: 30.31667});
    // Click 'Create a new queue at my current location']
    await page.click('#becomeAdmin');
  });

  afterAll(async () => {
    await cleanDB();
    await (await e2e).shutdownE2E();
    await teardown();
  });

  describe('should have correct start up elements', () => {
    it('should have user id', async () => {
      await page.waitForSelector(userIdSelector);
      await page.waitForFunction((userIdSelector) => {
        return document.querySelector(userIdSelector).innerHTML.includes('Start');
      }, userIdSelector, {timeout: 1000});
      const currentUser = await page.innerText(userIdSelector);
      expect(currentUser).toBe('Start Queue');
    });

    it('should have right queue length', async () => {
      await page.waitForSelector(queueLengthSelector);
      const queueLength = await page.innerText(queueLengthSelector);
      expect(queueLength).toBe('1');
    });

    it('should have the right location', async () => {
      await page.waitForSelector(locationSelector);
      const location = await page.innerText(locationSelector);
      expect(location).toMatch('9G');
    });

    it('should have location and password in the url', async () => {
      const url = await page.url();
      expect(url).toMatch(/location=OU.*&password=.*/);
    });
  });

  describe('Admin functions', () => {
    it('should be able to update admin message', async () => {
      const testMessage = new Date().toISOString();

      const url = await page.url();
      const userPage = await context.newPage();
      await userPage.goto(url.replace('admin', 'queue').replace(/password=.*/, ''));
      await userPage.waitForSelector(userPageAdminMessageSelector);
      const getAdminMessage = () => userPage.innerText(userPageAdminMessageSelector);
      expect(await getAdminMessage()).not.toMatch(testMessage);

      await page.waitForSelector(submitAdminMessageSelector);
      await page.type('textarea', testMessage);
      await page.click(submitAdminMessageSelector);

      await userPage.waitForTimeout(1000);
      const msg = await getAdminMessage();
      expect(msg).toMatch(testMessage);
    }, 60000);
  });
});
