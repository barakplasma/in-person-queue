import {
  connect,
  displayLocation,
  getQueue,
  request,
  setText,
  urlSearchParams,
  vibrate,
} from './sharedClientUtils.js';

const queue = getQueue();
if (!queue) location.href = './';
const adminSocket = connect('admin', {
  auth: {queue, password: urlSearchParams.get('password')},
});
const roomSocket = connect('room');

adminSocket.on('connect_error', (error) => {
  setText('#userId', `Not authorized for this queue (${error.message})`);
});
adminSocket.on('connect', () => refreshHeadOfQueue().catch(console.error));

roomSocket.on('connect', () => roomSocket.emit('join-queue', queue));
roomSocket.on('refresh-queue', ({queueLength}) => {
  setText('#queueLengthCount', queueLength);
  refreshHeadOfQueue().catch(console.error);
  vibrate();
});

async function refreshHeadOfQueue() {
  const {headOfQueue} = await request(adminSocket, 'refresh-queue');
  setText('#userId', headOfQueue || 'Queue is empty');
}

async function refresh() {
  try {
    const [{queueLength}] = await Promise.all([
      request(roomSocket, 'get-queue-length', queue),
      refreshHeadOfQueue(),
    ]);
    setText('#queueLengthCount', queueLength);
  } catch (error) {
    console.error(error);
  }
}

async function updateAdminMessage() {
  const text = document.querySelector('#admin-message').value;
  const {error} = await request(adminSocket, 'update-admin-message', text);
  if (error) alert(error);
}

async function currentUserDone() {
  if (window.confirm('confirm current user is done?')) {
    await request(adminSocket, 'current-user-done');
  }
}

function displayShareLink() {
  const url = new URL('queue.html', location.href);
  url.searchParams.set('location', queue);
  const link = document.querySelector('#shareLink a');
  link.href = url.href;
  const shareData = {title: 'Join Queue', text: `Join Queue at ${queue}`, url: url.href};
  if (navigator.canShare?.(shareData)) {
    const button = document.querySelector('#shareButton');
    button.hidden = false;
    button.addEventListener('click', () => navigator.share(shareData).catch(console.warn));
  }
}

async function loadAdminMessage() {
  const {adminMessage} = await request(roomSocket, 'get-admin-message', queue);
  document.querySelector('#admin-message').value = adminMessage ?? '';
}

displayLocation();
displayShareLink();
refresh();
loadAdminMessage().catch(console.error);

document.querySelector('#submit-admin-message').addEventListener('click', updateAdminMessage);
document.querySelector('#current-user-done').addEventListener('click', currentUserDone);
document.querySelector('#refresh-queue').addEventListener('click', refresh);
document.querySelector('#queueLengthContainer').addEventListener('click', refresh);
