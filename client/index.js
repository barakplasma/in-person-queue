/**
 * @type {import('socket.io-client')} io
 */
io;

const socket = io();
let userId;
let queue;

function getUserId() {
  if (typeof userId == 'undefined') {
    const localUserId = localStorage.getItem('userId');
    if (typeof localUserId == 'undefined') {
      userId = uuidv4();
      localStorage.setItem('userId', userId);
    } else {
      userId = localUserId;
    }
  }
  return userId;
}

function getQueue() {
  if (typeof queue == 'undefined') {
    queue = location.pathname.split('/')[2];
  }
  return queue;
}

function addSelfToQueue() {
  socket.emit('add-user', getQueue(), userId);
  document.querySelector('#join-queue').remove();
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
  socket.emit('get-my-position', getQueue(), userId);
}

function iAmDone() {
  socket.emit('user-done', getQueue(), userId)
  location.pathname = '';
}

function watchForQueuePositionUpdates() {
  socket.on('queue-changed', () => {
    refresh();
  });
  socket.on('update-queue-position', (msg) => {
    const { currentPosition } = msg;
    document.querySelector('#position-in-queue').innerHTML = currentPosition;
  });
}
