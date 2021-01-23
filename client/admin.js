/**
 * @type {import('socket.io-client')} io
 */
io;

const adminSocket = io(
  urlSearchParams.has('location') ?
    `${config['socket.io server host']}/admin/${urlSearchParams.get('location')}`
    : `${config['socket.io server host']}/`
);

function getAdminMessageText() {
  const el = document.querySelector('#edit-admin-message');
  const text = el && el.textContent;
  return text;
}

function updateAdminMessage() {
  const text = getAdminMessageText();
  adminSocket.emit("update-admin-message", (text, ack) => {
    window.alert('updated admin message');
  })
}

function currentUserDone() {
  if (window.confirm("confirm current user is done?")) {
    adminSocket.emit("current-user-done", getQueue(), refreshQueue)
  }
}

document.addEventListener("DOMContentLoaded", () => {
  refreshQueue();
});

adminSocket.on('queue-changed', () => {
  refreshQueue();
})

function refreshQueue() {
  adminSocket.emit("refresh-queue", getQueue(), ({ headOfQueue, queueLength }) => {
    updateHTML('#userId', headOfQueue || "Queue is empty");
    updateHTML('#queueLengthCount', queueLength);
    displayLocation();
  })
}

function iAmDone() {
  adminSocket.emit('admin-done', getQueue(), () => {
    location.href = `${location.protocol}//${location.host}`;
  })
}