import {
  api,
  displayLocation,
  getQueue,
  goHome,
  queuePath,
  setText,
  urlSearchParams,
  vibrate,
  watchQueue,
} from './sharedClientUtils.js';

const queue = getQueue();
const userId = urlSearchParams.get('userId');
if (!queue) goHome();
let lastPosition;

watchQueue(queue, userId ? {user: userId} : {}, ({gone, length, message, position}) => {
  if (gone) return setText('#admin-message', 'This queue has closed.');
  setText('#queueLengthCount', length);
  setText('#admin-message', message);
  if (!userId) return;
  const display = position ?? 'Not in queue';
  setText('#position-in-queue', display);
  if (lastPosition !== undefined && lastPosition !== display) vibrate();
  lastPosition = display;
  document.title = `Queue: ${display} - ${userId}`;
});

async function join() {
  const {error, userId} = await api(`${queuePath(queue)}/users`, {method: 'POST'});
  if (error) return alert(error);
  urlSearchParams.set('userId', userId);
  location.search = urlSearchParams.toString();
}

async function done() {
  if (userId) {
    await api(`${queuePath(queue)}/users/${encodeURIComponent(userId)}`, {method: 'DELETE'});
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
