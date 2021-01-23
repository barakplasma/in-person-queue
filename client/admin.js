/**
 * @type {import('socket.io-client')} io
 */
io;

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
    socket.emit("current-user-done")
  }
}

function refreshQueue() {
  socket.emit("refresh-queue")
}