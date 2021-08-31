// / <reference types="globals.d.ts">
import {
  config,
  updateHTML,
  urlSearchParams,
  displayLocation,
  getQueueFromAddressOrCache,
  iAmDoneRedirect,
  vibrate,
  generateUserId,
} from './sharedClientUtils.js';
import {
  makeRoomSocket,
  refreshQueueLength,
  displayQueueLength,
  joinQueue,
  refreshAdminMessage,
} from './queue.js';
import {io} from 'https://cdn.skypack.dev/pin/socket.io-client@v4.1.3-lNOiO7KseuUMlZav2OCQ/mode=imports,min/optimized/socket.io-client.js';

/**
 * @type {string?}
 */
let userId;

const userSocket = io(
  urlSearchParams.has('location') ?
    `${config['socket.io server host']}/user` :
    `${config['socket.io server host']}/`,
  {
    transports: ['websocket', 'polling'],
  },
);

function hasUserId() {
  return urlSearchParams.has('userId');
}

function displayJoinedState() {
  if (hasUserId()) {
    const joinQueueEl = document.querySelector('#join-queue');
    if (joinQueueEl) {
      joinQueueEl.remove();
    }
    displayUserId(getUserId());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(refreshQueue, 500);
});
document.addEventListener('DOMContentLoaded', async () => {
  joinQueue('user');
  if (hasUserId()) {
    await new Promise((resolve) => {
      userSocket.emit(
          'join-queue',
          getQueueFromAddressOrCache(),
          getUserId(),
          userSocket.id,
          resolve,
      );
    });
  }
  displayLocation();
  displayJoinedState();
});

function getUserId() {
  if (!userId) {
    const urlUserId = urlSearchParams.get('userId');
    if (!urlUserId) {
      userId = generateUserId();
    } else {
      userId = urlUserId;
    }
  }
  return userId;
}

export function addSelfToQueue() {
  const userId = getUserId();
  userSocket.emit(
      'add-user',
      getQueueFromAddressOrCache(),
      getUserId(),
      userSocket.id,
      displayJoinedState,
  );
  roomSocket.emit('add-to-queue');
  urlSearchParams.set('userId', userId);
  location.search = urlSearchParams.toString();
}

const roomSocket = makeRoomSocket();

roomSocket.on('refresh-queue', getMyPosition);
roomSocket.on('refresh-queue', displayAdminMessage);

export function getMyPosition() {
  userSocket.emit('get-my-position', displayMyPosition);
}

export function refreshQueue() {
  if (hasUserId()) {
    getMyPosition();
  }
  refreshQueueLength().then(displayQueueLength).catch(console.error);
  refreshAdminMessage().then(displayAdminMessage).catch(console.error);
}

export function iAmDone() {
  roomSocket.emit('remove-from-queue');
  userSocket.emit('user-done', iAmDoneRedirect);
}

function isUserPage() {
  return document.querySelector('#userId');
}

function displayUserId(userId) {
  updateHTML('#userId', userId);
}

export function displayAdminMessage({adminMessage}) {
  updateHTML('#admin-message', adminMessage ? adminMessage : '');
}

export function displayMyPosition(msg) {
  const {currentPosition} = msg;
  const displayPosition =
    currentPosition === null ? 'Not in queue' : currentPosition + 1;
  updateHTML('#position-in-queue', displayPosition);
  document.title = `Queue: ${displayPosition} - ${getUserId()}`;
}

userSocket.on('update-queue-position', displayMyPosition);
userSocket.on('update-queue-position', vibrate);
