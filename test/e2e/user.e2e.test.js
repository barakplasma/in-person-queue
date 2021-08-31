const {setupE2E, cleanDB, setupDB} = require('./sharedE2E');
const expect = require('expect');
const teardown = require('./teardown');

const userIdSelector = '#userId';
const queueLengthSelector = '#queueLengthCount';
const locationSelector = '#location';
const joinQueueSelector = '#join-queue';
const navigateToUserPageSelector = 'a[href*="queue.html"]';

describe('User page', () => {
  const e2e = setupE2E();
  /**
   * @type {import('playwright').Page} page
   */
  let page;
  let context;

  beforeAll(async () => {
    await setupDB();
    page = (await e2e).page;
    context = (await e2e).context;

    await page
        .waitForSelector(navigateToUserPageSelector)
        .catch((reason) =>
          console.error('did not find join queue selector because', reason),
        );
  });

  afterAll(async () => {
    await cleanDB();
    await (await e2e).shutdownE2E();
    await teardown();
  });

  describe('User joining queue', () => {
    it('should give user chance to navigate to queue from home page', async () => {
      await page.click(navigateToUserPageSelector);
    });

    it('should show queue length including "start-queue" user', async () => {
      await page.waitForLoadState('networkidle');
      const queueLength = await page.innerText(queueLengthSelector);
      expect(queueLength).toBe('1');
    });

    it('should give user chance to not join huge queue', async () => {
      const userIdDisplayed = await page.innerText(userIdSelector);
      expect(userIdDisplayed).toBe('N/A');
    });

    it('should show user position as not yet in queue', async () => {
      const positionInQueue = await page.innerText('#position-in-queue');
      expect(positionInQueue).toMatch('Not yet in queue');
    });

    it('should display user id after joining queue', async () => {
      await page.click(joinQueueSelector);
      await page.waitForEvent('websocket');
      const currentUser = await page.innerText(userIdSelector);
      expect(currentUser).not.toBe('N/A');
      expect(currentUser.length).toBeGreaterThan(5);
    });

    it('should show user position in queue', async () => {
      await page.waitForTimeout(1000);
      const positionInQueue = await page.innerText('#position-in-queue');
      expect(positionInQueue).toMatch('2');
    });

    it('should include start queue and current user', async () => {
      const queueLength = await page.innerText(queueLengthSelector);
      expect(queueLength).toBe('2');
    });

    it('should have the right location', async () => {
      const location = await page.innerText(locationSelector);
      expect(location).toBe('9GGGX828+2M');
    });

    it('should have a base64 encoded open location code', async () => {
      const url = await page.url();
      expect(url).toMatch('location=OUdHR1g4MjgrMk0%3D');
    });

    it('should have a userId in url', async () => {
      // await page.waitForNavigation();
      const url = await page.url();
      expect(url).toMatch(/userId=.{6}/);
    });
  });
  describe('Done button', () => {
    it('should redirect on done', async () => {
      const homePageRegex = /\/$/;
      expect(page.url()).toMatch('queue.html');
      await page.click('.done');
      await page.waitForURL(homePageRegex);
      expect(page.url()).toMatch(homePageRegex);
    });
  });
});
