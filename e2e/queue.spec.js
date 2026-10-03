const {test, expect} = require('@playwright/test');

// Each test gets its own random location, so tests never share queues or need a DB flush.
const randomLocation = () => ({
  latitude: Math.random() * 120 - 60,
  longitude: Math.random() * 340 - 170,
});

/** Creates a queue via the home page; leaves `page` on its admin page. */
async function createQueue(page) {
  await page.context().setGeolocation(randomLocation());
  await page.goto('/');
  await page.click('#becomeAdmin');
  await page.waitForURL(/admin\.html/);
  const url = new URL(page.url());
  return {location: url.searchParams.get('location'), password: url.searchParams.get('password')};
}

async function joinQueue(page, location) {
  await page.goto(`/queue.html?${new URLSearchParams({location: location})}`);
  await page.click('#join-queue');
  await page.waitForURL(/userId=/);
}

test('home page lists the nearby queue', async ({page, context}) => {
  const {location} = await createQueue(page);
  const home = await context.newPage();
  await home.goto('/');
  await expect(home.locator('#queues a')).toHaveText([location]);
  await expect(home.locator('header a')).toHaveAttribute(
    'href',
    'https://barakplasma.github.io/in-person-queue/',
  );
});

test('user can join and leave a queue', async ({page, context}) => {
  const {location} = await createQueue(page);
  const user = await context.newPage();
  await user.goto(`/queue.html?${new URLSearchParams({location: location})}`);
  await expect(user.locator('#queueLengthCount')).toHaveText('1');
  await expect(user.locator('#userId')).toHaveText('N/A');
  await expect(user.locator('#position-in-queue')).toHaveText('Not yet in queue');
  await expect(user.locator('#location')).toHaveText(location);

  await user.click('#join-queue');
  await user.waitForURL(/userId=[A-Z0-9]{6}/);
  await expect(user.locator('#userId')).toHaveText(/^[A-Z0-9]{6}$/);
  await expect(user.locator('#position-in-queue')).toHaveText('2');
  await expect(user.locator('#queueLengthCount')).toHaveText('2');
  await expect(user.locator('#join-queue')).toHaveCount(0);

  await user.click('#done-btn');
  await user.waitForURL(/\/$/);
  await expect(page.locator('#queueLengthCount')).toHaveText('1');
});

test('admin sees and serves the queue live', async ({page, context}) => {
  const {location} = await createQueue(page);
  await expect(page.locator('#userId')).toHaveText('Start Queue');
  await expect(page.locator('#queueLengthCount')).toHaveText('1');
  await expect(page.locator('#location')).toHaveText(location);

  const user = await context.newPage();
  await user.goto(await page.locator('#shareLink a').getAttribute('href'));
  await expect(user.locator('#location')).toHaveText(location);

  const message = `hello ${Date.now()}`;
  await page.fill('#admin-message', message);
  await page.click('#submit-admin-message');
  await expect(user.locator('#admin-message')).toHaveText(message);

  await user.click('#join-queue');
  await user.waitForURL(/userId=/);
  await expect(page.locator('#queueLengthCount')).toHaveText('2');

  page.on('dialog', (dialog) => dialog.accept());
  await page.click('#current-user-done');
  await expect(page.locator('#userId')).toHaveText(await user.locator('#userId').innerText());
  await expect(user.locator('#position-in-queue')).toHaveText('1');

  await page.click('.done');
  await page.waitForURL(/\/$/);
});

test('positions update for everyone when someone leaves', async ({page, context}) => {
  const {location} = await createQueue(page);
  const user1 = await context.newPage();
  const user2 = await context.newPage();
  await joinQueue(user1, location);
  await joinQueue(user2, location);
  await expect(user1.locator('#position-in-queue')).toHaveText('2');
  await expect(user2.locator('#position-in-queue')).toHaveText('3');
  await expect(user1.locator('#queueLengthCount')).toHaveText('3');

  await user1.click('#done-btn');
  await expect(user2.locator('#position-in-queue')).toHaveText('2');
  await expect(user2.locator('#queueLengthCount')).toHaveText('2');
});

test('admin page rejects a wrong password', async ({page, context}) => {
  const {location} = await createQueue(page);
  const attacker = await context.newPage();
  await attacker.goto(
    `/admin.html?${new URLSearchParams({location: location, password: 'wrong'})}`,
  );
  await expect(attacker.locator('#userId')).toHaveText(/Not authorized/);
  await expect(page.locator('#userId')).toHaveText('Start Queue');
});

test('user-controlled text is not rendered as HTML', async ({page, context}) => {
  const {location} = await createQueue(page);
  const user = await context.newPage();
  const evil = '<img src=x onerror="window.pwned=1">';
  await user.goto(`/queue.html?${new URLSearchParams({location: location, userId: evil})}`);
  await expect(user.locator('#userId')).toHaveText(evil);
  expect(await user.evaluate(() => globalThis.pwned)).toBeUndefined();
});

test('malformed socket input does not crash the server', async ({page, request}) => {
  await page.goto('/');
  const reply = await page.evaluate(async () => {
    const {io} = await import('/socket.io/socket.io.esm.min.js');
    return io('/').timeout(5000).emitWithAck('get-closest-queues', 'not a location');
  });
  expect(reply.error).toMatch(/invalid location/);
  expect((await request.get('/healthcheck')).ok()).toBeTruthy();
});

test('location links to OpenStreetMap, rounded to ~11m', async ({page}) => {
  const {latitude, longitude} = randomLocation();
  await page.context().setGeolocation({latitude, longitude});
  await page.goto('/');
  await page.click('#becomeAdmin');
  await page.waitForURL(/admin\.html/);
  const [lat, lon] = [latitude.toFixed(4), longitude.toFixed(4)];
  await expect(page.locator('#location')).toHaveText(`${lat},${lon}`);
  await expect(page.locator('#location')).toHaveAttribute(
    'href',
    `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
  );
});

test('invalid queue links go back to the home page', async ({page}) => {
  await page.goto('/queue.html?location=nonsense');
  await page.waitForURL(/\/$/);
});
