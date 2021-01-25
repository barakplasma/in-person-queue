/**
 * @type {import('socket.io-client')} io
 */
io;

let userId;

const userSocket = io(urlSearchParams.has('location') ?
  `${config['socket.io server host']}/user`
  : `${config['socket.io server host']}/`);

function hasUserId() {
  return urlSearchParams.has('userId');
}

function displayJoinedState() {
  if (hasUserId()) {
    let joinQueueEl = document.querySelector('#join-queue');
    if (joinQueueEl) {
      joinQueueEl.remove();
    }
    displayUserId(getUserId());
  }
}

function removeRefresh() {
  if (!hasUserId()) {
    let refreshEl = document.querySelector('#refresh-queue');
    if (refreshEl) {
      refreshEl.remove();
    }
  }
}

document.addEventListener("DOMContentLoaded", displayJoinedState);
document.addEventListener("DOMContentLoaded", displayLocation);
document.addEventListener("DOMContentLoaded", () => {
  joinQueue('user');
  if (hasUserId()) {
    roomSocket.emit('join-queue', getQueue(), getUserId());
    userSocket.emit('join-queue', getQueue(), getUserId());
    refreshMyPosition();
  } else {
    removeRefresh();
  }
});

function getUserId() {
  if (!userId) {
    const urlUserId = urlSearchParams.get('userId');
    if (!urlUserId) {
      const distinguishableCharacters = 'CDEHKMPRTUWXY012458'.split('');
      const lenDistinguishableCharacters = distinguishableCharacters.length;
      userId = crypto.getRandomValues(new Uint8ClampedArray(6)).reduce((acc, n) => acc + distinguishableCharacters[n % lenDistinguishableCharacters], "");
      urlSearchParams.set('userId', userId);
      location.search = urlSearchParams;
    } else {
      userId = urlUserId;
    }
  }
  return userId;
}

function addSelfToQueue() {
  userSocket.emit('add-user', getQueue(), getUserId(), displayJoinedState);
  roomSocket.emit('add-to-queue');
}

roomSocket.on('refresh-queue', getMyPosition);
roomSocket.on('refresh-queue', updateQueueLength);

function getMyPosition() {
  userSocket.emit('get-my-position', updatePositionInDom);
}

function refreshMyPosition() {
  getMyPosition();
  refreshQueueLength().then(updateQueueLength);
}

function iAmDone() {
  userSocket.emit('user-done', () => {
    location.href = `${location.protocol}//${location.host}`;
  })
  roomSocket.emit('remove-from-queue');
}


function isQueuePage() {
  return document.querySelector('#queueLengthCount');
}

function displayUserId(userId) {
  updateHTML('#userId', userId);
}

function updateQueueLength(queueLength) {
  updateHTML('#queueLengthCount', queueLength);
}

function updatePositionInDom(msg) {
  const { currentPosition } = msg;
  const displayPosition = currentPosition === null ? "Not in queue" : currentPosition + 1;
  updateHTML('#position-in-queue', displayPosition);
  document.title = `Queue: ${displayPosition} - ${getUserId()}`;
}

userSocket.on('update-queue-position', updatePositionInDom);
