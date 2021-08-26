/// <reference types="globals.d.ts">

const adminSocket = io(urlSearchParams.has('location') ?
  `${config['socket.io server host']}/admin`
  : `${config['socket.io server host']}/`, {
  auth: {
    queue: urlSearchParams.get('location'),
    password: urlSearchParams.get('password')
  }
});

function getAdminMessageText() {
  /**
   * @type {HTMLTextAreaElement?}
   */
  const el = document.querySelector('textarea[name="edit-admin-message"]');
  const html = el && el.value || "";
  return html;
}

function updateAdminMessage() {
  const text = getAdminMessageText();
  adminSocket.emit("update-admin-message", text, () => {
    roomSocket.emit('refresh-queue');
  })
}

function currentUserDone() {
  if (window.confirm("confirm current user is done?")) {
    adminSocket.emit("current-user-done", refreshHeadOfQueue)
    roomSocket.emit('remove-from-queue');
  }
  refreshAdminPage();
}

document.addEventListener("DOMContentLoaded", () => {
  joinQueue('admin');
  adminSocket.emit('join-queue', getQueue());
  refreshAdminPage();
});

roomSocket.on('refresh-queue', refreshHeadOfQueue);
roomSocket.on('add-to-queue', refreshAdminPage);

function refreshAdminPage() {
  refreshHeadOfQueue();
  refreshQueueLength().then(displayQueueLength)
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