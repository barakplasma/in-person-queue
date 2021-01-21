/**
 * @type {import('socket.io-client')} io
 */
io;

let userId;
let queue;
let urlSearchParams = new URLSearchParams(location.search);
let env = localStorage.getItem('env') || "prod";
let config = {
  "socket.io server host": {
    "prod": "chisoonnumber.fly.dev",
    "test": localStorage.getItem('test host') || 'localhost:3000'
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

function getQueue() {
  if (!queue) {
    const queueId = btoa(urlSearchParams.get('location'));
    queue = { queueId };
  }
  displayLocation(atob(queue.queueId));
  return queue;
}

function addSelfToQueue() {
  socket.emit('add-user', getQueue(), getUserId(), displayJoinedState);
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
      queue = { queueId: btoa(currentOpenLocationCode) };
      socket.emit('create-queue', queue, () => {
        gotoQueue(currentOpenLocationCode);
      });
    }

    function error() {
      console.error('Unable to retrieve your location');
    }

    navigator.geolocation.getCurrentPosition(success, error);
  }
}

function refreshMyPosition() {
  socket.emit('get-my-position', getQueue(), getUserId(), updatePositionInDom);
}

function iAmDone() {
  socket.emit('user-done', getQueue(), getUserId(), () => {
    location.href = `${location.protocol}//${location.host}`;
  })
}

function refreshQueueLength() {
  socket.emit('get-queue-length', getQueue(), updateQueueLength);
}
function updateHTML(selector, value) {
  document.querySelector(selector).innerHTML = value;
}
function isQueuePage() {
  return document.querySelector('#queueLengthCount');
}

function displayLocation(location) {
  const fixed = location.replace(' ', '+');
  updateHTML('#location', `<a target="_blank" href="https://plus.codes/${fixed}">${fixed}</a>`);
}

function displayUserId(userId) {
  updateHTML('#userId', userId);
}

function firstLoad() {
  removeRefresh();
}

function updateQueueLength(msg) {
  const { queueLength } = msg;
  updateHTML('#queueLengthCount', queueLength);
}

function updatePositionInDom(msg) {
  const { currentPosition } = msg;
  updateHTML('#position-in-queue', currentPosition);
  document.title = `Queue: ${currentPosition} - ${getUserId()}`;
}

socket.on('update-queue-position', updatePositionInDom);
