const { setupE2E, cleanDB } = require('./sharedE2E');
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
  let queueId;
  let queueMetadataId;

  beforeAll(async () => {
    await cleanDB()
    page = (await e2e).page;
    context = (await e2e).context;

    await context.setGeolocation({ latitude: 60.95, longitude: 30.31667 });

    await page.click(becomeUserSelector);
    await page.waitForSelector(joinQueueSelector);
  })

  afterAll(async () => {
    await cleanDB();
    let { shutdownE2E } = (await e2e);
    await shutdownE2E();
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
      const queueLength = await page.innerText(queueLengthSelector);
      expect(queueLength).toBe("1");
    })

    it('should have the right location', async () => {
      const location = await page.innerText(locationSelector);
      expect(location).toBe("9GGGX828+2M")
    })

    it('should have a base64 encoded location', async () => {
      const url = await page.url();
      expect(url).toMatch('location=OUdHR1g4MjgrMk0%3D');
    })

    it('should have a userId', async () => {
      const url = await page.url();
      expect(url).toMatch(/userId=.{6}/);
    })
  })
})