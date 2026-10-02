const http = require('node:http');
const path = require('node:path');
const {readFile} = require('node:fs/promises');
const {connection} = require('./socket/connection');
const {_redis: redis} = require('./queue/queue');

const PORT = process.env.PORT || '3000';
const CLIENT_DIR = path.join(__dirname, 'client');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function handler(req, res) {
  const {pathname} = new URL(req.url, 'http://localhost');

  if (pathname === '/healthcheck') {
    const ok = redis.status === 'ready';
    res.writeHead(ok ? 200 : 503, {'content-type': 'application/json'});
    return res.end(JSON.stringify({redis: redis.status}));
  }

  const file = path.join(CLIENT_DIR, pathname === '/' ? 'index.html' : pathname);
  const type = CONTENT_TYPES[path.extname(file)];
  if (!file.startsWith(CLIENT_DIR + path.sep) || !type) {
    res.writeHead(404);
    return res.end('not found');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {'content-type': type});
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

const server = http.createServer(handler);
const io = connection(server);

server.listen(PORT, () => console.log('listening on *:' + PORT));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    io.close(async () => {
      await redis.quit().catch(console.error);
      process.exit(0);
    });
  });
}
