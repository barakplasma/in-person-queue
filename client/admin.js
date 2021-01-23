/**
 * @type {import('socket.io-client')} io
 */
io;

const socket = io(
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
  socket.emit("update-admin-message", (ack) => {
    window.alert('updated admin message');
  })
}

function currentUserDone() {
  if (window.confirm("confirm current user is done?")) {
    socket.emit("current-user-done", getQueue(), refreshQueue)
  }
}

document.addEventListener("DOMContentLoaded", () => {
  refreshQueue();
});

function refreshQueue() {
  socket.emit("refresh-queue", getQueue(), ({ headOfQueue, queueLength }) => {
    updateHTML('#userId', headOfQueue || "Queue is empty");
    updateHTML('#queueLengthCount', queueLength);
    displayLocation();
  })
}

function iAmDone() {
  socket.emit('admin-done', getQueue(), () => {
    location.href = `${location.protocol}//${location.host}`;
  })
}