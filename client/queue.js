/// <reference types="globals.d.ts">

const roomSocket = io(urlSearchParams.has('location') ?
  `${config['socket.io server host']}/room`
  : `${config['socket.io server host']}/`)

function refreshQueueLength() {
  return new Promise((resolve, reject) => {
    roomSocket.emit('get-queue-length', resolve);
    setTimeout(() => reject('timeout queue length'), 5000);
  })
}

function refreshAdminMessage() {
  return new Promise((resolve, reject) => {
    roomSocket.emit('get-admin-message', resolve);
    setTimeout(() => reject('timeout admin'), 5000);
  })
}

function displayQueueLength(msg) {
  const { queueLength } = msg;
  updateHTML('#queueLengthCount', queueLength)
}

roomSocket.on('refresh-queue', displayQueueLength);

function joinQueue(type) {
  return new Promise(resolve => roomSocket.emit('join-queue', getQueue(), type, resolve));
}