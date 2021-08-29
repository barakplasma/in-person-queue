const process = require('process');
const port = process.env.PORT || '3000';

const {setupE2E, cleanDB, setupDB} = require('./sharedE2E');
const expect = require('expect');
const teardown = require('./teardown');

const navigateToUserPageSelector = 'a[href*="queue.html"]';

describe('User page', () => {
  const e2e = setupE2E();
  /**
   * @type {import('playwright').Page} page
   */
  let page;
  let context;

  beforeAll(async () => {
    page = (await e2e).page;
    context = (await e2e).context;
  });

  afterAll(async () => {
    await cleanDB();
    await (await e2e).shutdownE2E();
    await teardown();
  });

  describe('Homepage', () => {
    it('should give user chance to navigate to queue from home page',
        async () => {
          await page.waitForSelector(navigateToUserPageSelector)
              .catch((reason) => console.error(
                  'did not find join queue selector because', reason,
              ));
          expect(await page.isVisible(navigateToUserPageSelector)).toBeTruthy();
        });

    it('should show 1 nearby queues', async () => {
      expect(await page.$$(navigateToUserPageSelector)).toHaveLength(1);
    });

    it('should have an about link', async () => {
      const aLink = await page.$('body > footer > a');
      expect(await aLink.innerText()).toMatch('About');
      expect(await aLink.getAttribute('href')).toMatch('https://barakplasma.github.io/in-person-queue/');
    });
  });
});
