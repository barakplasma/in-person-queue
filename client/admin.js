import {
  api,
  displayLocation,
  formatDateTime,
  formatWait,
  getQueue,
  queuePath,
  renderPeople,
  setText,
  urlSearchParams,
  vibrate,
  watchQueue,
} from './sharedClientUtils.js';

const queue = getQueue();
if (!queue) location.href = './';
const token = urlSearchParams.get('password') ?? '';
let lastLength;

async function start() {
  const {error} = await api(`${queuePath(queue)}/admin`, {token});
  if (error) return setText('#userId', `Not authorized for this queue (${error})`);

  let firstState = true;
  watchQueue(queue, {token}, ({gone, length, message, head, people, closes, serviceSeconds}) => {
    if (gone) return setText('#userId', 'This queue has closed.');
    setText('#queueLengthCount', length);
    setText('#wait', formatWait(length, serviceSeconds));
    setText('#closes', formatDateTime(closes));
    renderPeople(people, undefined, serviceSeconds);
    setText('#userId', head || 'Queue is empty');
    if (firstState) document.querySelector('#admin-message').value = message;
    firstState = false;
    if (lastLength !== undefined && length > lastLength) vibrate(); // someone joined
    lastLength = length;
  });
}

async function updateAdminMessage() {
  const message = document.querySelector('#admin-message').value;
  const {error} = await api(`${queuePath(queue)}/message`, {method: 'PUT', body: {message}, token});
  if (error) alert(error);
}

async function currentUserDone() {
  if (window.confirm('confirm current user is done?')) {
    const {error} = await api(`${queuePath(queue)}/next`, {method: 'POST', token});
    if (error) alert(error);
  }
}

function displayShareLink() {
  const url = new URL('queue.html', location.href);
  url.searchParams.set('location', queue);
  document.querySelector('#shareLink a').href = url.href;
  document.querySelector('#displayLink').href =
    `display.html?${new URLSearchParams({location: queue})}`;
  const shareData = {title: 'Join Queue', text: `Join Queue at ${queue}`, url: url.href};
  if (navigator.canShare?.(shareData)) {
    const button = document.querySelector('#shareButton');
    button.hidden = false;
    button.addEventListener('click', () => navigator.share(shareData).catch(console.warn));
  }
}

displayLocation();
displayShareLink();
start();

document.querySelector('#submit-admin-message').addEventListener('click', updateAdminMessage);
document.querySelector('#current-user-done').addEventListener('click', currentUserDone);
document.querySelector('#refresh-queue').addEventListener('click', () => location.reload());
