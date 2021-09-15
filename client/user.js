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

const roomSocket = makeRoomSocket();

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
  joinQueue();
  if (hasUserId()) {
    roomSocket.emit(
        'join-queue',
        getQueueFromAddressOrCache(),
    );
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
  roomSocket.emit('add-user',
      getQueueFromAddressOrCache(),
      getUserId(),
      roomSocket.id,
      displayJoinedState,
  );
  roomSocket.emit('add-to-queue');
  urlSearchParams.set('userId', userId);
  location.search = urlSearchParams.toString();
}

roomSocket.on('refresh-queue', getMyPosition);
roomSocket.on('refresh-queue', displayAdminMessage);

export function getMyPosition() {
  roomSocket.emit('get-my-position', userId, displayMyPosition);
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
  roomSocket.emit('user-done', getQueueFromAddressOrCache(),
      getUserId(), iAmDoneRedirect);
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
  const displayPosition = currentPosition === null ?
    'Not in queue' : currentPosition + 1;
  updateHTML('#position-in-queue', displayPosition);
  document.title = `Queue: ${displayPosition} - ${getUserId()}`;
}

roomSocket.on('update-queue-position', displayMyPosition);
roomSocket.on('update-queue-position', vibrate);
