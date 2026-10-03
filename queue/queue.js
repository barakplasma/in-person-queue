const {Redis} = require('ioredis');

const redis = new Redis(process.env.REDIS_CONNECTION_STRING);

// Queues expire a day after creation so the geo index and keyspace don't grow forever.
const QUEUE_TTL_SECONDS = 24 * 60 * 60;

const meta = (queue) => 'qm:' + queue;

// Adds a user to the end of an existing queue, atomically.
// Returns the new score, 0 if the user was already queued, -1 if the queue doesn't exist.
// The zset is deleted by redis when it empties, so the metadata hash is the source of truth.
redis.defineCommand('addToEndOfQueue', {
  numberOfKeys: 2,
  lua: `
    if redis.call('exists', KEYS[2]) == 0 then return -1 end
    if redis.call('zscore', KEYS[1], ARGV[1]) then return 0 end
    local last = redis.call('zrevrange', KEYS[1], 0, 0, 'WITHSCORES')
    local score = (tonumber(last[2]) or 0) + 1
    redis.call('zadd', KEYS[1], score, ARGV[1])
    local ttl = redis.call('pttl', KEYS[2])
    -- queues created before TTLs existed return -1, and pexpire(-1) would delete the queue
    if ttl > 0 then redis.call('pexpire', KEYS[1], ttl) end
    return score
  `,
});

// Creates a queue atomically: a crash can't leave a password without a queue or TTL.
// Returns 0 if a queue already exists at that location.
redis.defineCommand('createQueue', {
  numberOfKeys: 3,
  lua: `
    if redis.call('hsetnx', KEYS[2], 'password', ARGV[1]) == 0 then return 0 end
    redis.call('expire', KEYS[2], ARGV[2])
    redis.call('zadd', KEYS[1], 1, 'Start Queue')
    redis.call('expire', KEYS[1], ARGV[2])
    redis.call('geoadd', KEYS[3], ARGV[3], ARGV[4], KEYS[1])
    return 1
  `,
});

const LOCATION = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
// 4 decimals is ~11m: people creating a queue at the same spot share it
const round = (n) => (Math.round(n * 1e4) / 1e4).toFixed(4);

/**
 * Parses "lat,lon" into rounded coordinates and the canonical queue location.
 * @param {string} location
 * @return {{lat: number, lon: number, location: string}}
 */
function parseLocation(location) {
  const match = LOCATION.exec(String(location));
  // redis geo indexes only cover latitudes within ±85.05112878
  if (!match || Math.abs(match[1]) > 85.05112878 || Math.abs(match[2]) > 180) {
    throw new Error('invalid location: ' + location);
  }
  const [lat, lon] = [round(match[1]), round(match[2])];
  return {lat: Number(lat), lon: Number(lon), location: `${lat},${lon}`};
}

async function addUserToQueue(queue, userId) {
  const score = await redis.addToEndOfQueue(queue, meta(queue), userId);
  if (score === -1) {
    throw new Error('This queue has closed or does not exist.');
  }
  const log =
    score === 0
      ? {EventName: 'user already in queue', queue, userId}
      : {EventName: 'added to queue', queue, userId, endOfQueueScore: score};
  console.log(log);
  return log;
}

async function removeUserFromQueue(queue, userId) {
  const removed = await redis.zrem(queue, userId);
  console.log({EventName: 'removed from queue', removed, queue, userId});
}

/**
 * @return {Promise<boolean>} false if a queue already exists at that location
 */
async function createQueue(queue, password) {
  if (!password) {
    throw new Error('password required');
  }
  const {lat, lon} = parseLocation(queue.slice(2));
  const created = await redis.createQueue(
    queue,
    meta(queue),
    'queues',
    password,
    QUEUE_TTL_SECONDS,
    lon,
    lat,
  );
  if (!created) {
    return false;
  }
  console.log({EventName: 'created queue', queue});
  return true;
}

async function getPosition(queue, userId) {
  return await redis.zrank(queue, userId);
}

async function getClosestQueues(location) {
  const {lat, lon} = parseLocation(location);
  const closest = await redis.geosearch(
    'queues',
    'FROMLONLAT',
    lon,
    lat,
    'BYRADIUS',
    100000,
    'm',
    'ASC',
    'COUNT',
    5,
    'WITHDIST',
  );
  const result = [];
  for (const [queue, distance] of closest) {
    if (await redis.exists(meta(queue))) {
      result.push({queue: queue.slice(2), distance});
    } else {
      await redis.zrem('queues', queue); // expired
    }
  }
  return result;
}

async function getQueueLength(queue) {
  return await redis.zcard(queue);
}

async function getHeadOfQueue(queue) {
  return (await redis.zrange(queue, 0, 0))[0];
}

async function shiftQueue(queue) {
  return await redis.zpopmin(queue);
}

async function checkAuthForQueue({queue, password}) {
  return Boolean(password) && (await redis.hget(meta(queue), 'password')) === password;
}

async function getQueueMetadata(queue) {
  return await redis.hgetall(meta(queue));
}

async function updateAdminMessage(queue, adminMessage) {
  return await redis.hset(meta(queue), {adminMessage: String(adminMessage).slice(0, 1000)});
}

module.exports = {
  parseLocation,
  addUserToQueue,
  removeUserFromQueue,
  createQueue,
  getPosition,
  getQueueLength,
  getHeadOfQueue,
  shiftQueue,
  checkAuthForQueue,
  updateAdminMessage,
  getQueueMetadata,
  getClosestQueues,
  _redis: redis,
};
