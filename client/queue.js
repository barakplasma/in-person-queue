import {
  connect,
  displayLocation,
  generateUserId,
  getQueue,
  goHome,
  request,
  setText,
  urlSearchParams,
  vibrate,
} from './sharedClientUtils.js';

const roomSocket = connect('room');
const queue = getQueue();
const userId = urlSearchParams.get('userId');

// (re)join the room on every (re)connect; rooms don't survive reconnects
roomSocket.on('connect', () => roomSocket.emit('join-queue', queue));

roomSocket.on('refresh-queue', ({queueLength, adminMessage}) => {
  setText('#queueLengthCount', queueLength);
  setText('#admin-message', adminMessage);
  refreshPosition();
  vibrate();
});

async function refreshPosition() {
  if (!userId) return;
  const {currentPosition} = await request(roomSocket, 'get-my-position', queue, userId);
  const display = currentPosition === null ? 'Not in queue' : currentPosition + 1;
  setText('#position-in-queue', display);
  document.title = `Queue: ${display} - ${userId}`;
}

async function refresh() {
  try {
    const [{queueLength}, {adminMessage}] = await Promise.all([
      request(roomSocket, 'get-queue-length', queue),
      request(roomSocket, 'get-admin-message', queue),
      refreshPosition(),
    ]);
    setText('#queueLengthCount', queueLength);
    setText('#admin-message', adminMessage);
  } catch (error) {
    console.error(error);
  }
}

async function join() {
  const newUserId = generateUserId();
  const {error} = await request(roomSocket, 'add-user', queue, newUserId);
  if (error) return alert(error);
  urlSearchParams.set('userId', newUserId);
  location.search = urlSearchParams.toString();
}

async function done() {
  if (userId) await request(roomSocket, 'user-done', queue, userId).catch(console.error);
  goHome();
}

if (userId) {
  document.querySelector('#join-queue')?.remove();
  setText('#userId', userId);
}
displayLocation();
refresh();

document.querySelector('#join-queue')?.addEventListener('click', join);
document.querySelector('#refresh-queue').addEventListener('click', refresh);
document.querySelector('#queueLengthContainer').addEventListener('click', refresh);
document.querySelectorAll('.done').forEach((d) => d.addEventListener('click', done));
