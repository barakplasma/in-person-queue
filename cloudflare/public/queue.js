import {
  api,
  displayLocation,
  formatDateTime,
  formatWait,
  getQueue,
  goHome,
  queuePath,
  renderPeople,
  setText,
  urlSearchParams,
  vibrate,
  watchQueue,
} from './sharedClientUtils.js';

const queue = getQueue();
const userId = urlSearchParams.get('userId');
const key = urlSearchParams.get('key') ?? ''; // proves we are userId, to leave
if (!queue) goHome();
let lastPosition;

watchQueue(queue, userId ? {user: userId} : {}, (state) => {
  const {gone, length, message, position, people, closes, serviceSeconds} = state;
  if (gone) return setText('#admin-message', 'This queue has closed.');
  setText('#queueLengthCount', length);
  setText('#admin-message', message);
  setText('#closes', formatDateTime(closes));
  // in line: the people ahead of you; not yet: everyone
  setText('#wait', formatWait(position ? position - 1 : length, serviceSeconds));
  renderPeople(people, userId, serviceSeconds);
  if (!userId) return;
  const display = position ?? 'Not in queue';
  setText('#position-in-queue', display);
  if (lastPosition !== undefined && lastPosition !== display) vibrate();
  lastPosition = display;
  document.title = `Queue: ${display} - ${userId}`;
});

async function join() {
  const {error, userId, key} = await api(`${queuePath(queue)}/users`, {method: 'POST'});
  if (error) return alert(error);
  urlSearchParams.set('userId', userId);
  urlSearchParams.set('key', key);
  location.search = urlSearchParams.toString();
}

async function done() {
  if (userId) {
    await api(`${queuePath(queue)}/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      token: key,
    });
  }
  goHome();
}

if (userId) {
  document.querySelector('#join-queue')?.remove();
  setText('#userId', userId);
}
displayLocation();

document.querySelector('#join-queue')?.addEventListener('click', join);
document.querySelector('#refresh-queue').addEventListener('click', () => location.reload());
document.querySelectorAll('.done').forEach((d) => d.addEventListener('click', done));
