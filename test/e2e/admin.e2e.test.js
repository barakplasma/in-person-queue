const { setupE2E } = require('./sharedE2E');
const expect = require('expect');

const userIdSelector = '#userId';
const queueLengthSelector = '#queueLengthCount';
const locationSelector = '#location > a:nth-child(1)';

describe('Admin page', () => {
  let e2e = setupE2E();
  /**
   * @type {import('playwright').Page} page
   */
  let page;

  beforeAll(async () => {
    page = (await e2e).page;

    // Click 'Create a new queue at my current location']
    await page.click('//button[normalize-space(.)=\'Create a new queue at my current location\']');
  })

  afterAll(async () => {
    let {shutdownE2E} = (await e2e);
    await shutdownE2E()
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
      await page.waitForSelector(queueLengthSelector);
      const queueLength = await page.innerText(queueLengthSelector);
      expect(queueLength).toBe("1");
    })

    it('should have the right location', async () => {
      await page.waitForSelector(locationSelector);
      const location = await page.innerText(locationSelector);
      expect(location).toBe("9GFGX828+2M")
    })
  })
})