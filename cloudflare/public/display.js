// Display mode: a read-only screen for a tablet, TV or laptop. Needs no admin password.
import {
  formatDateTime,
  formatWait,
  getQueue,
  goHome,
  setText,
  urlSearchParams,
  watchQueue,
} from './sharedClientUtils.js';

const queue = getQueue();
if (!queue) goHome();
const top = Math.max(1, Number(urlSearchParams.get('top')) || 5); // ?top=N people after the one being served

const join = new URL('queue.html', location.href);
join.searchParams.set('location', queue);
setText('#joinUrl', join.href);

// keep the screen on, where the browser allows it
navigator.wakeLock?.request('screen').catch(() => {});

watchQueue(queue, {}, ({gone, length, message, people, closes, serviceSeconds}) => {
  if (gone) return setText('#serving', 'Closed');
  const [head, ...rest] = people;
  setText('#serving', !head ? '—' : head.id === 'Start Queue' ? 'Starting soon' : head.id);
  setText('#display-message', message);
  setText('#queueLengthCount', length);
  setText('#wait', formatWait(length, serviceSeconds));
  setText('#closes', formatDateTime(closes));
  const tbody = document.querySelector('#next tbody');
  tbody.replaceChildren();
  rest.slice(0, top).forEach(({id}, i) => {
    const row = tbody.insertRow();
    row.insertCell().textContent = id;
    row.insertCell().textContent = formatWait(i + 1, serviceSeconds);
  });
});
