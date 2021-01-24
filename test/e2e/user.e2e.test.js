const { setupE2E } = require('./sharedE2E');
const expect = require('expect');

const becomeUserSelector = '#becomeUser';
const userIdSelector = '#userId';
const queueLengthSelector = '#queueLengthCount';
const locationSelector = '#location';
const joinQueueSelector = '#join-queue';

describe('User page', () => {
  let e2e = setupE2E();
  /**
   * @type {import('playwright').Page} page
   */
  let page;

  beforeAll(async () => {
    page = (await e2e).page;
    await page.click(becomeUserSelector);
    await page.waitForSelector(joinQueueSelector);
  })

  afterAll(async () => {
    let {shutdownE2E} = (await e2e);
    await shutdownE2E()
  })

  describe('should have correct start up elements', () => {
    it('should give user chance to not join huge queue', async () => {
      const currentUser = await page.innerText(userIdSelector);
      expect(currentUser).toBe("N/A");
    })

    it('should have user id', async () => {
      await page.click(joinQueueSelector);
      await page.waitForEvent('websocket');
      const currentUser = await page.innerText(userIdSelector);
      expect(currentUser).not.toBe("N/A");
      expect(currentUser.length).toBeGreaterThan(5);
    })

    it('should have right queue length', async () => {
      // await page.waitForSelector(queueLengthSelector);
      const queueLength = await page.innerText(queueLengthSelector);
      expect(queueLength).toBe("1");
    })

    it('should have the right location', async () => {
      // await page.waitForSelector(locationSelector);
      const location = await page.innerText(locationSelector);
      expect(location).toBe("9GFGX828+2M")
    })
  })
})