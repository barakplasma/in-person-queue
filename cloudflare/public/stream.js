// Cloudflare build: live updates over a WebSocket, which a Durable Object can hold while it
// hibernates (no compute billed while idle). Replaces client/stream.js, the server-sent-events version.

/**
 * @param {string} url
 * @param {(data: any) => void} onData
 * @return {() => void} stops the stream
 */
export function subscribe(url, onData) {
  const wsUrl = new URL(url, location.href);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket;
  let ping;
  let stopped = false;
  let retry = 1000;
  const connect = () => {
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      retry = 1000;
      // answered by the runtime without waking the Durable Object; keeps proxies from dropping us
      ping = setInterval(() => socket.send('ping'), 30_000);
    };
    socket.onmessage = (event) => event.data !== 'pong' && onData(JSON.parse(event.data));
    socket.onclose = () => {
      clearInterval(ping);
      if (!stopped) setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
    };
  };
  connect();
  return () => {
    stopped = true;
    socket.close();
  };
}
