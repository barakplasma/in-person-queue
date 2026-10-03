// in-person-queue on Cloudflare Workers (free plan) or celld: the same JSON API as the Go server.
//
//   Worker      routes /api/* and /healthz; static files (the web client) are served by the platform
//   Queue       one Durable Object per queue location: its own SQLite, hibernating WebSockets, an alarm at closing time
//   Directory   one Durable Object listing open queues, for "nearby queues"

import {DurableObject} from 'cloudflare:workers';

const maxUsers = 1000; // waiting at once
const maxTicket = 25999; // A001 … Z999
const maxQueues = 10000;
const maxMessage = 10000; // characters
const maxBody = 128 << 10;
const nearbyRadius = 100_000; // meters
const nearbyCount = 5;
const defaultOpen = 24 * 3600_000;
const maxOpen = 366 * 24 * 3600_000;
const serviceSmoothing = 0.3; // see docs/adr/0003-wait-time-estimate.md
const startMarker = 'Start Queue';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const errNotFound = () => new HttpError(404, 'this queue has closed or does not exist');
const errUnauthorized = () => new HttpError(401, 'not authorized for this queue');

/** "lat,lon" rounded to 4 decimals (~11 m), or an error; same rules as parseLocation in store.go */
export function parseLocation(s) {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s ?? '');
  const round4 = (x) => (Math.sign(x) * Math.round(Math.abs(x) * 1e4)) / 1e4 + 0; // half away from zero, like Go; + 0 drops -0
  const [lat, lon] = m ? [round4(Number(m[1])), round4(Number(m[2]))] : [];
  if (!m || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new HttpError(400, `invalid location: ${JSON.stringify(s)}`);
  }
  return {lat, lon, location: `${lat.toFixed(4)},${lon.toFixed(4)}`};
}

/** haversine distance in meters */
function distance(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** constant-time string comparison */
function same(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A001 … Z999, like the paper tickets at an Israeli post office */
const ticketID = (n) =>
  String.fromCharCode(65 + Math.floor(n / 1000)) + String(n % 1000).padStart(3, '0');

export class Queue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // answered by the runtime while the object hibernates (see src/stream.js)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  #schema() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (
      location TEXT, password TEXT, message TEXT, seq INTEGER, closes INTEGER, served INTEGER, service REAL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS people (
      ticket INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, joined INTEGER NOT NULL)`);
  }

  /** the queue's row, or null if it is closed or never existed */
  #meta() {
    try {
      const row = this.sql.exec('SELECT * FROM meta').toArray()[0];
      return row && row.closes > Date.now() ? row : null;
    } catch {
      return null; // no tables: never created, or deleted at closing time
    }
  }

  #live() {
    const meta = this.#meta();
    if (!meta) throw errNotFound();
    return meta;
  }

  async #admin(password) {
    const meta = this.#live();
    if (!password || !same(await sha256(password), meta.password)) throw errUnauthorized();
    return meta;
  }

  /** proves who joined as id: an HMAC keyed by the password hash, so nothing more is stored */
  async #leaveKey(meta, id) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(meta.password),
      {name: 'HMAC', hash: 'SHA-256'},
      false,
      ['sign'],
    );
    return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id))).slice(0, 32);
  }

  async create(location, closes) {
    if (this.#meta())
      throw new HttpError(409, 'a queue already exists at this location, join it instead');
    await this.ctx.storage.deleteAll(); // whatever a closed queue left behind
    this.#schema();
    const password = hex(crypto.getRandomValues(new Uint8Array(16)));
    this.sql.exec(
      'INSERT INTO meta VALUES (?, ?, ?, 0, ?, NULL, NULL)',
      location,
      await sha256(password),
      '',
      closes,
    );
    this.sql.exec('INSERT INTO people VALUES (0, ?, ?)', startMarker, Date.now());
    await this.ctx.storage.setAlarm(closes);
    return password;
  }

  async authorized(password) {
    await this.#admin(password);
  }

  async join() {
    const meta = this.#live();
    const n = this.sql.exec('SELECT count(*) AS n FROM people').one().n;
    if (n >= maxUsers || meta.seq >= maxTicket) throw new HttpError(429, 'this queue is full');
    const seq = meta.seq + 1;
    const id = ticketID(seq);
    // an idle line: service time counts from now, not from the last serve
    this.sql.exec(
      'UPDATE meta SET seq = ?, served = CASE WHEN ? = 0 THEN ? ELSE served END',
      seq,
      n,
      Date.now(),
    );
    this.sql.exec('INSERT INTO people VALUES (?, ?, ?)', seq, id, Date.now());
    this.#broadcast();
    return {userId: id, key: await this.#leaveKey(meta, id)};
  }

  async leave(id, key) {
    const meta = this.#live();
    if (!same(key ?? '', await this.#leaveKey(meta, id))) throw errUnauthorized();
    this.sql.exec('DELETE FROM people WHERE id = ?', id);
    this.#broadcast();
  }

  async next(password) {
    const meta = await this.#admin(password);
    const head = this.sql.exec('SELECT id FROM people ORDER BY ticket LIMIT 1').toArray()[0];
    if (!head) return;
    const now = Date.now();
    // moving average of the time between serves; serving the start marker only starts the clock
    if (head.id !== startMarker && meta.served !== null) {
      const interval = now - meta.served;
      const service =
        meta.service === null
          ? interval
          : serviceSmoothing * interval + (1 - serviceSmoothing) * meta.service;
      this.sql.exec('UPDATE meta SET service = ?', Math.round(service));
    }
    this.sql.exec('UPDATE meta SET served = ?', now);
    this.sql.exec('DELETE FROM people WHERE id = ?', head.id);
    this.#broadcast();
  }

  async setMessage(password, message) {
    await this.#admin(password);
    this.sql.exec(
      'UPDATE meta SET message = ?',
      Array.from(String(message)).slice(0, maxMessage).join(''),
    );
    this.#broadcast();
  }

  /** the queue as one subscriber sees it; same shape as View in store.go */
  #view(user, admin) {
    const meta = this.#meta();
    if (!meta) return {gone: true};
    const people = this.sql.exec('SELECT id, joined FROM people ORDER BY ticket').toArray();
    const view = {length: people.length, message: meta.message, people, closes: meta.closes};
    if (meta.service !== null) view.serviceSeconds = Math.round(meta.service) / 1000;
    if (user) {
      const i = people.findIndex((p) => p.id === user);
      if (i >= 0) view.position = i + 1;
    }
    if (admin) view.head = people[0]?.id ?? '';
    return view;
  }

  #broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const {user, admin} = ws.deserializeAttachment();
      const view = this.#view(user, admin);
      ws.send(JSON.stringify(view));
      if (view.gone) ws.close(1000, 'closed');
    }
  }

  /** WebSocket upgrade for /api/queues/{loc}/events?user=&token= */
  async fetch(request) {
    const params = new URL(request.url).searchParams;
    const admin = params.has('token');
    if (admin) {
      try {
        await this.#admin(params.get('token'));
      } catch (e) {
        return Response.json({error: e.message}, {status: e.status ?? 500});
      }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({user: params.get('user') ?? '', admin});
    server.send(JSON.stringify(this.#view(params.get('user'), admin)));
    return new Response(null, {status: 101, webSocket: client});
  }

  async webSocketMessage() {} // clients only send pings, which the runtime answers

  /** closing time: tell everyone, then delete the queue */
  async alarm() {
    const meta = this.sql.exec('SELECT location FROM meta').toArray()[0];
    await this.ctx.storage.deleteAll();
    this.#broadcast(); // #meta() is now null: everyone gets {gone: true}
    if (meta) await this.env.DIRECTORY.getByName('directory').remove(meta.location);
  }
}

// ponytail: one object for every queue's location: fine for thousands of queues; shard by region if it ever isn't.
export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS queues (location TEXT PRIMARY KEY, lat REAL, lon REAL, closes INTEGER)',
    );
  }

  add(location, lat, lon, closes) {
    this.sql.exec('DELETE FROM queues WHERE closes <= ?', Date.now());
    if (this.sql.exec('SELECT count(*) AS n FROM queues').one().n >= maxQueues) {
      throw new HttpError(429, 'too many queues on this server, try again later');
    }
    this.sql.exec('INSERT OR REPLACE INTO queues VALUES (?, ?, ?, ?)', location, lat, lon, closes);
  }

  remove(location) {
    this.sql.exec('DELETE FROM queues WHERE location = ?', location);
  }

  nearby(lat, lon) {
    const near = nearbyRadius / 111_000 + 0.01; // degrees of latitude, a cheap first filter
    return this.sql
      .exec(
        'SELECT location, lat, lon FROM queues WHERE closes > ? AND lat BETWEEN ? AND ?',
        Date.now(),
        lat - near,
        lat + near,
      )
      .toArray()
      .map((q) => ({queue: q.location, distance: distance(lat, lon, q.lat, q.lon)}))
      .filter((q) => q.distance <= nearbyRadius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, nearbyCount);
  }
}

async function readJSON(request) {
  const text = await request.text();
  if (text.length > maxBody) throw new HttpError(413, 'request too large');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, `bad request: ${e.message}`);
  }
}

const bearer = (request) => (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');

/** the API; every other path is a static file */
async function api(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').slice(1).map(decodeURIComponent); // ['api', 'queues', loc, ...]
  const method = request.method;
  if (url.pathname === '/healthz') return Response.json({status: 'ok'});
  if (url.pathname === '/') return env.ASSETS.fetch(new URL('/index.html', url));
  if (parts[0] !== 'api' || parts[1] !== 'queues') throw new HttpError(404, 'not found');
  const directory = env.DIRECTORY.getByName('directory');

  if (parts.length === 2 && method === 'GET') {
    const {lat, lon} = parseLocation(url.searchParams.get('near'));
    return Response.json(await directory.nearby(lat, lon));
  }
  if (parts.length === 2 && method === 'POST') {
    const body = await readJSON(request);
    const {lat, lon, location} = parseLocation(body.location);
    const closes = body.closes ? Date.parse(body.closes) : Date.now() + defaultOpen;
    if (!(closes > Date.now() && closes - Date.now() <= maxOpen)) {
      throw new HttpError(400, 'the closing time must be in the future, and within a year');
    }
    await directory.add(location, lat, lon, closes);
    const password = await env.QUEUE.getByName(location).create(location, closes);
    return Response.json({location, password}, {status: 201});
  }

  const {location} = parseLocation(parts[2]);
  const queue = env.QUEUE.getByName(location);
  const route = `${method} ${parts.slice(3, 4).join('/')}`;
  switch (route) {
    case 'GET events':
      if (request.headers.get('Upgrade') !== 'websocket')
        throw new HttpError(426, 'expected a WebSocket');
      return queue.fetch(request);
    case 'POST users':
      if (parts.length === 4) return Response.json(await queue.join(), {status: 201});
      break;
    case 'DELETE users':
      if (parts.length === 5)
        return queue.leave(parts[4], bearer(request)).then(() => new Response(null, {status: 204}));
      break;
    case 'GET admin':
      return queue.authorized(bearer(request)).then(() => new Response(null, {status: 204}));
    case 'POST next':
      return queue.next(bearer(request)).then(() => new Response(null, {status: 204}));
    case 'PUT message': {
      const {message = ''} = await readJSON(request);
      return queue
        .setMessage(bearer(request), message)
        .then(() => new Response(null, {status: 204}));
    }
  }
  throw new HttpError(404, 'not found');
}

export default {
  async fetch(request, env) {
    try {
      return await api(request, env);
    } catch (e) {
      // errors thrown inside a Durable Object arrive as plain Errors: recover the status from the message
      const status = e.status ?? statusFor(e.message);
      if (status === 500) console.error(e);
      return Response.json({error: e.message}, {status});
    }
  },
};

function statusFor(message) {
  for (const [status, text] of [
    [404, 'closed or does not exist'],
    [401, 'not authorized'],
    [409, 'already exists'],
    [429, 'full'],
    [429, 'too many queues'],
  ]) {
    if (message?.includes(text)) return status;
  }
  return 500;
}
