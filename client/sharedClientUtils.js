export const urlSearchParams = new URLSearchParams(location.search);

/**
 * Socket.io backend; defaults to the server that served this page.
 * Set localStorage 'backend' (e.g. "https://queue.example.com") when hosting the client elsewhere.
 */
const backend = localStorage.getItem('backend') ?? '';
// socket.io serves its own (version-matched) client
const {io} = await import(`${backend}/socket.io/socket.io.esm.min.js`);

/**
 * @param {'' | 'room' | 'admin'} namespace
 * @param {object} [options]
 */
export function connect(namespace, options) {
  return io(`${backend}/${namespace}`, options);
}

/** @return {string} the "lat,lon" of the current queue, or '' if the link is invalid */
export function getQueue() {
  const location = urlSearchParams.get('location') ?? '';
  return /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location) ? location : '';
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

export function generateUserId() {
  const distinguishableCharacters = 'CDEHKMPRTUWXY012458';
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (n) => distinguishableCharacters[n % distinguishableCharacters.length],
  ).join('');
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

/** Resolves with a socket.io ack, or rejects after a timeout. */
export function request(socket, event, ...args) {
  return socket.timeout(5000).emitWithAck(event, ...args);
}
