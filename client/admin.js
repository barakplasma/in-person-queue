/**
 * @type {import('socket.io-client')} io
 */
io;

const adminSocket = io(urlSearchParams.has('location') ?
`${config['socket.io server host']}/admin`
: `${config['socket.io server host']}/`);

function getAdminMessageText() {
  const el = document.querySelector('#edit-admin-message');
  const text = el && el.textContent;
  return text;
}

function updateAdminMessage() {
  const text = getAdminMessageText();
  adminSocket.emit("update-admin-message", text, () => {
    window.alert('updated admin message');
  })
}

function currentUserDone() {
  if (window.confirm("confirm current user is done?")) {
    adminSocket.emit("current-user-done", refreshHeadOfQueue)
    roomSocket.emit('remove-from-queue');
    refreshQueueLength().then(updateQueueLength)
  }
}

document.addEventListener("DOMContentLoaded", () => {
  joinQueue('admin');
  adminSocket.emit('join-queue', getQueue());
  refreshAdminPage();
});

function updateQueueLength(queueLength) {
  updateHTML('#queueLengthCount', queueLength)
}

roomSocket.on('refresh-queue', refreshHeadOfQueue);
roomSocket.on('refresh-queue', updateQueueLength);
roomSocket.on('add-to-queue', refreshAdminPage);

function refreshAdminPage() {
  refreshHeadOfQueue();
  refreshQueueLength().then(updateQueueLength)
}

function refreshHeadOfQueue() {
  displayLocation();
  adminSocket.emit("refresh-queue", ({ headOfQueue }) => {
    updateHTML('#userId', headOfQueue || "Queue is empty");
  })
}

function iAmDone() {
  adminSocket.emit('admin-done', () => {
    location.href = `${location.protocol}//${location.host}`;
  })
}