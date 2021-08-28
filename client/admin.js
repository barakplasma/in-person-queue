// / <reference types="globals.d.ts">

const adminSocket = io(urlSearchParams.has('location') ?
  `${config['socket.io server host']}/admin` :
  `${config['socket.io server host']}/`, {
  auth: {
    queue: urlSearchParams.get('location'),
    password: urlSearchParams.get('password'),
  },
});

function getAdminMessageText() {
  /**
   * @type {HTMLTextAreaElement?}
   */
  const el = document.querySelector('textarea[name="edit-admin-message"]');
  const html = el && el.value || '';
  return html;
}

function updateAdminMessage() {
  const text = getAdminMessageText();
  adminSocket.emit('update-admin-message', text, () => {
    roomSocket.emit('refresh-queue');
  });
}

function currentUserDone() {
  if (window.confirm('confirm current user is done?')) {
    adminSocket.emit('current-user-done', refreshHeadOfQueue);
    roomSocket.emit('remove-from-queue');
  }
  refreshAdminPage();
}

function generateShareURL() {
  const params = new URLSearchParams(location.search);
  const shareLinkUrl = new URL(location.origin +
    location.pathname.replace(/admin\.html/, 'queue.html'));
  shareLinkUrl.searchParams.set('location', params.get('location'));
  return shareLinkUrl;
}

function generateShareLink() {
  const shareLinkUrl = generateShareURL();
  updateHTML('#shareLink',
      `link to join queue as user: <a href="${shareLinkUrl.href}">link</a><a id="shareButton"></a>`);
  generateShareButton();
}

function generateShareButton() {
  if (navigator.share) {
    const shareLinkUrl = generateShareURL();

    const shareData = {
      title: 'Join Queue',
      text: 'Join Queue at ' + atob(shareLinkUrl.searchParams.get('location')),
      url: shareLinkUrl.href,
    };

    const btn = document.querySelector('#shareButton');
    updateHTML('#shareButton', '<img src="share.png">');

    if (btn) {
      async function share() {
        try {
          await navigator.share(shareData);
        } catch (err) {
          console.warn(err);
        }
      }
      btn.addEventListener('click', share);
      btn.addEventListener('touchstart', share);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  joinQueue('admin');
  adminSocket.emit('join-queue', getQueueFromAddressOrCache());
  generateShareLink();
  refreshAdminPage();
});

roomSocket.on('refresh-queue', refreshHeadOfQueue);
roomSocket.on('refresh-queue', () => {
  if (navigator.vibrate) {
    navigator.vibrate(200);
  }
});
roomSocket.on('add-to-queue', refreshAdminPage);

function refreshAdminPage() {
  refreshHeadOfQueue();
  refreshQueueLength().then(displayQueueLength);
}

function refreshHeadOfQueue() {
  displayLocation();
  adminSocket.emit('refresh-queue', ({headOfQueue}) => {
    updateHTML('#userId', headOfQueue || 'Queue is empty');
  });
}

function iAmDone() {
  adminSocket.emit('admin-done', iAmDoneRedirect);
}
