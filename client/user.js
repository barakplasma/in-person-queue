// / <reference types="globals.d.ts">

/**
 * @type {string?}
 */
let userId;

const userSocket = io(urlSearchParams.has('location') ?
  `${config['socket.io server host']}/user` :
  `${config['socket.io server host']}/`);

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

function removeRefresh() {
  if (!hasUserId()) {
    const refreshEl = document.querySelector('#refresh-queue');
    if (refreshEl) {
      refreshEl.remove();
    }
  }
}

document.addEventListener('DOMContentLoaded', displayJoinedState);
document.addEventListener('DOMContentLoaded', displayLocation);
document.addEventListener('DOMContentLoaded', () => {
  joinQueue('user');
  refreshQueue();
});
document.addEventListener('DOMContentLoaded', async () => {
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
    refreshQueue();
  } else {
    removeRefresh();
  }
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

function addSelfToQueue() {
  const userId = getUserId();
  userSocket.emit('add-user',
      getQueueFromAddressOrCache(),
      getUserId(),
      userSocket.id,
      displayJoinedState,
  );
  roomSocket.emit('add-to-queue');
  urlSearchParams.set('userId', userId);
  location.search = urlSearchParams.toString();
}

roomSocket.on('refresh-queue', getMyPosition);
roomSocket.on('refresh-queue', displayAdminMessage);

function getMyPosition() {
  userSocket.emit('get-my-position', displayMyPosition);
}

function refreshQueue() {
  if (hasUserId()) {
    getMyPosition();
  }
  refreshQueueLength().then(displayQueueLength).catch(console.error);
  refreshAdminMessage().then(displayAdminMessage).catch(console.error);
}

function iAmDone() {
  roomSocket.emit('remove-from-queue');
  userSocket.emit('user-done', iAmDoneRedirect);
}


function isUserPage() {
  return document.querySelector('#userId');
}

function displayUserId(userId) {
  updateHTML('#userId', userId);
}

function displayAdminMessage({adminMessage}) {
  updateHTML('#admin-message', adminMessage);
}

function displayMyPosition(msg) {
  const {currentPosition} = msg;
  const displayPosition = currentPosition === null ? 'Not in queue' : currentPosition + 1;
  updateHTML('#position-in-queue', displayPosition);
  document.title = `Queue: ${displayPosition} - ${getUserId()}`;
}

userSocket.on('update-queue-position', displayMyPosition);
userSocket.on('update-queue-position', vibrate);
