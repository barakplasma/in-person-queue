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
  await expect(home.locator('#queues td').nth(1)).toHaveText(/^\d+ m$/);
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
  await user.waitForURL(/userId=A001/);
  await expect(user.locator('#userId')).toHaveText('A001');
  await expect(user.locator('#people tbody tr')).toHaveCount(2);
  await expect(user.locator('#people mark')).toHaveText('A001');
  await expect(page.locator('#people tbody td:nth-child(2)')).toHaveText(['Start Queue', 'A001']);
  await expect(page.locator('#people tbody td:nth-child(3)').first()).toHaveText(/\d\d/);
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

test('malformed input is rejected without hurting the server', async ({request}) => {
  const reply = await request.get('/api/queues?near=not%20a%20location');
  expect(reply.status()).toBe(400);
  expect((await reply.json()).error).toMatch(/invalid location/);
  expect((await request.get('/healthz')).ok()).toBeTruthy();
});

const osm = (lat, lon) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;

for (const [phone, userAgent, href] of [
  ['desktop', undefined, (lat, lon) => osm(lat, lon)],
  [
    'iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    (lat, lon) => `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`,
  ],
  [
    'Android',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9)',
    (lat, lon) => `geo:${lat},${lon}?q=${lat},${lon}`,
  ],
]) {
  test(`location opens the maps app on ${phone}, rounded to ~11m`, async ({browser}) => {
    const {latitude, longitude} = randomLocation();
    const context = await browser.newContext({
      userAgent,
      geolocation: {latitude, longitude},
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.click('#becomeAdmin');
    await page.waitForURL(/admin\.html/);
    const [lat, lon] = [latitude.toFixed(4), longitude.toFixed(4)];
    await expect(page.locator('#location')).toHaveText(`${lat},${lon}`);
    await expect(page.locator('#location')).toHaveAttribute('href', href(lat, lon));
    await expect(page.locator('#location-osm')).toHaveAttribute('href', osm(lat, lon));
    await context.close();
  });
}

test('invalid queue links go back to the home page', async ({page}) => {
  await page.goto('/queue.html?location=nonsense');
  await page.waitForURL(/\/$/);
});
