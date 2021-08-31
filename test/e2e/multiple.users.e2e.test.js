const {setupE2E, cleanDB} = require('./sharedE2E');
const expect = require('expect');
const teardown = require('./teardown');

const queueLengthSelector = '#queueLengthCount';
const joinQueueSelector = '#join-queue';
const navigateToUserPageSelector = 'a[href*="queue.html"]';

describe('Multiple Users', () => {
  const e2e = setupE2E();

  afterAll(async () => {
    await cleanDB();
    await (await e2e).shutdownE2E();
    await teardown();
  });

  describe('Two Users in queue', () => {
    it('should have two users join, and when one is done, the second is next',
        async () => {
          const user1Page = (await e2e).page;
          const context = (await e2e).context;

          await user1Page.waitForSelector(navigateToUserPageSelector)
              .catch((reason) => console.error(
                  'did not find join queue selector because',
                  reason,
              ));

          await user1Page.click(navigateToUserPageSelector);

          await user1Page.waitForLoadState('networkidle');

          const wsU1 = function(...args) {
            console.debug('user1Page', ...args);
          };
          user1Page.on('websocket', (ws) => {
            wsU1(ws.url());
            ws.on('framesent', wsU1);
            ws.on('framereceived', wsU1);
            // ws.on('close', wsSpyUser1);
          });

          // await context.tracing.start({ screenshots: true, snapshots: true })

          await user1Page.click(joinQueueSelector);

          await user1Page.waitForTimeout(1000);

          const user2Page = await context.newPage();

          await user2Page.goto(user1Page.url().replace(/userId.*$/, ''));

          const wsU2 = function(...args) {
            console.debug('user2Page', ...args);
          };
          user2Page.on('websocket', (ws) => {
            wsU2(ws.url());
            ws.on('framesent', wsU2);
            ws.on('framereceived', wsU2);
            // ws.on('close', wsSpyUser2);
          });

          await user2Page.click(joinQueueSelector);

          await user2Page.waitForTimeout(1000);
          await user1Page.waitForTimeout(1000);

          const user1QueueLength = await await user1Page
              .innerText(queueLengthSelector);
          // await context.tracing.stop({ path: 'trace.zip' });
          expect(user1QueueLength).toBe('3');

          await user2Page.waitForTimeout(1000);
          async function assertPosition(page, position) {
            expect(await page
                .innerText('#position-in-queue')).toMatch(position.toString());
          }

          await assertPosition(user2Page, 3);

          await user2Page.waitForTimeout(1000);
          await assertPosition(user1Page, 2);

          await user1Page.click('text=Done');

          await user2Page.waitForTimeout(1000);

          // await user2Page.pause();
          await assertPosition(user2Page, 2);
        }, 6e5);
  });
});
