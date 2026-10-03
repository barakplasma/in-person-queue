// How live updates arrive: server-sent events from the Go server; the browser reconnects on its own.
// The Cloudflare build swaps this file for a WebSocket version (cloudflare/src/stream.js).

/**
 * @param {string} url
 * @param {(data: any) => void} onData
 * @return {() => void} stops the stream
 */
export function subscribe(url, onData) {
  const events = new EventSource(url);
  events.onmessage = (event) => onData(JSON.parse(event.data));
  return () => events.close();
}
