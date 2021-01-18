/**
 * @type {import('socket.io-client')} io
 */
io;

let userId;
let queue;
let urlSearchParams = new URLSearchParams(location.search);
let env = "test";
let config = {
    "socket.io server host": {
      "prod": "xyz.com",
      "test": "localhost:3000"
    }[env]
};

const socket = io(
  urlSearchParams.has('location') ?
    `${config['socket.io server host']}/queue/${urlSearchParams.get('location')}`
    : `${config['socket.io server host']}/`
);

function hasUserId() {
  return urlSearchParams.has('userId');
}

function removeJoinButtonIfAlreadyJoined() {
  if (hasUserId()) {
    let joinQueueEl = document.querySelector('#join-queue');
    if (joinQueueEl) {
      joinQueueEl.remove();
    }
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

document.addEventListener("DOMContentLoaded", removeJoinButtonIfAlreadyJoined);
document.addEventListener("DOMContentLoaded", () => {
  if (hasUserId()) {
    refresh();
  } else {
    removeRefresh()
  }
});

function getUserId() {
  if (!userId) {
    const urlUserId = urlSearchParams.get('userId');
    if (!urlUserId) {
      userId = uuidv4();
      urlSearchParams.set('userId', userId);
      location.search = urlSearchParams;
      document.title = `${userId}:`;
    } else {
      userId = urlUserId;
    }
  }
  return userId;
}

function getQueue() {
  if (!queue) {
    const queueId = urlSearchParams.get('location');
    if (!queueId) {
      queue = uuidv4();
      urlSearchParams.set('location', queue);
      location.search = urlSearchParams;
    } else {
      queue = queueId;
    }
  }
  return queue;
}

function addSelfToQueue() {
  socket.emit('add-user', getQueue(), getUserId());
  removeJoinButtonIfAlreadyJoined();
}

function gotoQueue(currentOpenLocationCode) {
  let goto = new URL(location.href);
  goto.pathname = `${location.pathname}queue.html`;
  goto.search = `location=${currentOpenLocationCode}`;
  location.href = goto.toString();
}

function createQueue() {
  if (!navigator.geolocation) {
    console.error('Geolocation is not supported by your browser');
  } else {
    function success(position) {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const currentOpenLocationCode = OpenLocationCode.encode(latitude, longitude);

      socket.emit('create-queue', currentOpenLocationCode);
      gotoQueue(currentOpenLocationCode);
    }

    function error() {
      console.error('Unable to retrieve your location');
    }

    navigator.geolocation.getCurrentPosition(success, error);
  }
}

function refresh() {
  socket.emit('get-my-position', getQueue(), getUserId(), updatePositionInDom);
}

function iAmDone() {
  socket.emit('user-done', getQueue(), getUserId(), () => {
    location.href = `${location.protocol}//${location.host}`;
  })
}

function updatePositionInDom(msg) {
  const { currentPosition } = msg;
  document.querySelector('#position-in-queue').innerHTML = currentPosition;
  document.title = `Queue: ${currentPosition} - ${getUserId()}`;
}

socket.on('queue-changed', refresh);
socket.on('update-queue-position', updatePositionInDom);
