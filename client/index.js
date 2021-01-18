/**
 * @type {import('socket.io-client')} io
 */
io;

let userId;
let queue;
let urlSearchParams = new URLSearchParams(location.search);
const socket = io(location.href);

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
  if(hasUserId()) {
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
    queue = location.pathname.split('/')[2];
  }
  return queue;
}

function addSelfToQueue() {
  socket.emit('add-user', getQueue(), getUserId());
  removeJoinButtonIfAlreadyJoined();
  socket.emit('queue-changed');
  watchForQueuePositionUpdates();
}

function createQueue() {
  if (!navigator.geolocation) {
    console.error('Geolocation is not supported by your browser');
  } else {
    function success(position) {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const currentOpenLocationCode = OpenLocationCode.encode(latitude, longitude);

      console.log(`Latitude: ${latitude} °, Longitude: ${longitude} °`);
      console.log(currentOpenLocationCode);

      socket.emit('create-queue', currentOpenLocationCode);
      location.pathname = '/queue/' + currentOpenLocationCode;
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
  socket.emit('user-done', getQueue(), getUserId())
  location.href = `${location.protocol}//${location.host}`;
}

function updatePositionInDom(msg) {
  const { currentPosition } = msg;
  document.querySelector('#position-in-queue').innerHTML = currentPosition;
  document.title = `Queue: ${currentPosition} - ${getUserId()}`;
}

function watchForQueuePositionUpdates() {
  socket.on('queue-changed', () => {
    refresh();
  });
  socket.on('update-queue-position', updatePositionInDom);
}
