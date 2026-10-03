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
 * @param {(state: {gone?: boolean, length: number, message: string, position?: number, head?: string}) => void} onState
 */
export function watchQueue(queue, params, onState) {
  const events = new EventSource(`api${queuePath(queue)}/events?${new URLSearchParams(params)}`);
  events.onmessage = (event) => {
    const state = JSON.parse(event.data);
    if (state.gone) events.close();
    onState(state);
  };
  return events;
}

export function displayLocation() {
  const location = getQueue();
  if (location) {
    const [lat, lon] = location.split(',');
    const a = document.querySelector('#location');
    a.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
    a.target = '_blank';
    a.textContent = location;
  }
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
