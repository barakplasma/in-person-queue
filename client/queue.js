/**
 * @type {import('socket.io-client')} io
 */
io;

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
  roomSocket.emit('join-queue', getQueue(), type);
}