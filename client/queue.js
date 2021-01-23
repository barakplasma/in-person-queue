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
    setTimeout(reject, 5000);
  })
}

function joinQueue(type) {
  roomSocket.emit('join-queue', getQueue(), type);
}