/**
 * @type {import('socket.io-client')} io
 */
io;

const socket = io();
let userId;
let queue;
let urlSearchParams = new URLSearchParams(location.search);

function removeJoinButton() {
  if (urlSearchParams.has('userId')) {
    let joinQueueEl = document.querySelector('#join-queue');
    if (joinQueueEl) {
      joinQueueEl.remove();
    }
  }
}

document.addEventListener("DOMContentLoaded", removeJoinButton);

function getUserId() {
  if (!userId) {
    const urlUserId = urlSearchParams.get('userId');
    if (!urlUserId) {
      userId = uuidv4();
      urlSearchParams.set('userId', userId);
      location.search = urlSearchParams;
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
  removeJoinButton();
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
  location.pathname = '';
}

function updatePositionInDom(msg) {
  const { currentPosition } = msg;
  document.querySelector('#position-in-queue').innerHTML = currentPosition;
}

function watchForQueuePositionUpdates() {
  socket.on('queue-changed', () => {
    refresh();
  });
  socket.on('update-queue-position', updatePositionInDom);
}
