/**
 * @type {import('socket.io-client')} io
 */
io;

let userId;

const socket = io(
  urlSearchParams.has('location') ?
    `${config['socket.io server host']}/queue/${urlSearchParams.get('location')}`
    : `${config['socket.io server host']}/`
);

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
document.addEventListener("DOMContentLoaded", () => {
  if (isQueuePage()) {
    refreshQueueLength();
    if (hasUserId()) {
      socket.on('queue-changed', refreshMyPosition);
      refreshMyPosition();
    } else {
      firstLoad();
    }
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
  socket.emit('add-user', getQueue(), getUserId(), displayJoinedState);
}

function gotoPage(pageName, currentOpenLocationCode) {
  let goto = new URL(location.href);
  goto.pathname = `${location.pathname}${pageName}.html`;
  goto.search = `location=${currentOpenLocationCode}`;
  location.href = goto.toString();
}

function redirectToQueuePage(currentOpenLocationCode) {
  gotoPage('queue', currentOpenLocationCode);
}

function redirectToAdminPage(currentOpenLocationCode) {
  gotoPage('admin', currentOpenLocationCode);
}

function getLocationDecorator(callback) {
  if (!navigator.geolocation) {
    console.error('Geolocation is not supported by your browser');
  } else {
    function success(position) {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const currentOpenLocationCode = OpenLocationCode.encode(latitude, longitude);
      queue = btoa(currentOpenLocationCode);
      callback(queue)
    }

    function error() {
      console.error('Unable to retrieve your location');
    }

    navigator.geolocation.getCurrentPosition(success, error);
  }
}

function joinQueue() {
  getLocationDecorator(() => {
    socket.emit('join-queue', getQueue(), () => {
      redirectToQueuePage(getQueue());
    });
  });
}

function createQueue() {
  getLocationDecorator(() => {
    socket.emit('create-queue', getQueue(), () => {
      redirectToAdminPage(getQueue());
    });
  });
}

function refreshMyPosition() {
  socket.emit('get-my-position', getQueue(), getUserId(), updatePositionAndQueueLength);
}

function iAmDone() {
  socket.emit('user-done', getQueue(), getUserId(), () => {
    location.href = `${location.protocol}//${location.host}`;
  })
}

function refreshQueueLength() {
  socket.emit('get-queue-length', getQueue(), updateQueueLength);
}

function isQueuePage() {
  return document.querySelector('#queueLengthCount');
}

function displayUserId(userId) {
  updateHTML('#userId', userId);
}

function firstLoad() {
  removeRefresh();
  displayLocation();
}

function updateQueueLength(msg) {
  const { queueLength } = msg;
  updateHTML('#queueLengthCount', queueLength);
}

function updatePositionAndQueueLength(msg) {
  updatePositionInDom(msg);
  updateQueueLength(msg);
}

function updatePositionInDom(msg) {
  const { currentPosition } = msg;
  const displayPosition = currentPosition === null ? "Not in queue" : currentPosition + 1;
  updateHTML('#position-in-queue', displayPosition);
  document.title = `Queue: ${displayPosition} - ${getUserId()}`;
}

socket.on('update-queue-position', updatePositionInDom);
