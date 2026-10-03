import {subscribe} from './stream.js';

export const urlSearchParams = new URLSearchParams(location.search);

/** @return {string} the "lat,lon" of the current queue, or '' if the link is invalid */
export function getQueue() {
  const location = urlSearchParams.get('location') ?? '';
  return /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location) ? location : '';
}

/**
 * Calls the JSON API. Resolves with the response body, or {error} on failure.
 * @param {string} path e.g. "/queues"
 * @param {{method?: string, body?: object, token?: string}} [options]
 */
export async function api(path, {method = 'GET', body, token} = {}) {
  try {
    const response = await fetch(`api${path}`, {
      method,
      headers: {
        ...(body && {'Content-Type': 'application/json'}),
        ...(token && {Authorization: `Bearer ${token}`}),
      },
      body: body && JSON.stringify(body),
    });
    const data = response.status === 204 ? {} : await response.json();
    return response.ok ? data : {error: data.error ?? response.statusText};
  } catch (error) {
    return {error: error.message};
  }
}

/** API path for a queue */
export const queuePath = (queue) => `/queues/${encodeURIComponent(queue)}`;

/**
 * Live queue state from the server; the browser reconnects on its own.
 * @param {string} queue
 * @param {Record<string, string>} params user and/or token
 * @param {(state: {gone?: boolean, length: number, message: string, position?: number, head?: string, people: {id: string, joined: number}[], closes: number, serviceSeconds?: number}) => void} onState
 */
export function watchQueue(queue, params, onState) {
  const stop = subscribe(
    `api${queuePath(queue)}/events?${new URLSearchParams(params)}`,
    (state) => {
      if (state.gone) stop();
      onState(state);
    },
  );
}

/**
 * Links the location to the phone's own maps app (Apple Maps on iOS, the geo: app on Android),
 * with OpenStreetMap as the fallback everywhere.
 */
export function displayLocation() {
  const location = getQueue();
  if (!location) return;
  const [lat, lon] = location.split(',');
  const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
  const ua = navigator.userAgent;
  const a = document.querySelector('#location');
  a.textContent = location;
  if (/iPhone|iPad|iPod|Macintosh/.test(ua)) {
    a.href = `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`;
  } else if (/Android/.test(ua)) {
    a.href = `geo:${lat},${lon}?q=${lat},${lon}`; // opens the default maps app, usually Google Maps
  } else {
    a.href = osm;
    a.target = '_blank';
  }
  const fallback = document.querySelector('#location-osm');
  fallback.href = osm;
  fallback.target = '_blank';
}

/**
 * Fills the #people table: everyone in line, in order, with when they joined.
 * @param {{id: string, joined: number}[]} people
 * @param {string} [me] the viewer's id, highlighted
 */
export function renderPeople(people, me, serviceSeconds) {
  const tbody = document.querySelector('#people tbody');
  tbody.replaceChildren();
  people.forEach(({id, joined}, i) => {
    const row = tbody.insertRow();
    row.insertCell().textContent = i + 1;
    const ticket = row
      .insertCell()
      .appendChild(document.createElement(id === me ? 'mark' : 'span'));
    ticket.textContent = id;
    row.insertCell().textContent = formatTime(joined);
    row.insertCell().textContent = formatWait(i, serviceSeconds);
  });
}

/** @param {number} ms unix ms */
export const formatTime = (ms) =>
  new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

/** @param {number} ms unix ms */
export const formatDateTime = (ms) =>
  new Date(ms).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'});

/**
 * Estimated wait behind `ahead` people, from the server's measured time to serve one person
 * (see estimateService in store.go).
 * @param {number} ahead
 * @param {number | undefined} serviceSeconds undefined until the admin has served someone
 */
export function formatWait(ahead, serviceSeconds) {
  if (ahead === 0) return 'now';
  if (!(serviceSeconds > 0)) return 'estimating…';
  const seconds = ahead * serviceSeconds;
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `~${minutes} min` : `~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Sets the text of an element, if it exists on this page. */
export function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value ?? '';
}

export function vibrate() {
  navigator.vibrate?.(200);
}

export function goHome() {
  location.href = location.pathname.replace(/[^/]*$/, '');
}
