const {Redis} = require('ioredis');
const OpenLocationCode = require('../client/vendor/openlocationcode');

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
    redis.call('pexpire', KEYS[1], redis.call('pttl', KEYS[2]))
    return score
  `,
});

/**
 * @param {string} plusCode
 * @return {{latitudeCenter: number, longitudeCenter: number}}
 */
function decodePlusCode(plusCode) {
  if (!OpenLocationCode.isFull(plusCode)) {
    throw new Error('invalid plus code: ' + plusCode);
  }
  return OpenLocationCode.decode(plusCode);
}

async function addUserToQueue(queue, userId) {
  const score = await redis.addToEndOfQueue(queue, meta(queue), userId);
  if (score === -1) {
    throw new Error('queue does not exist: ' + queue);
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
  const {latitudeCenter, longitudeCenter} = decodePlusCode(queue.slice(2));
  const created = await redis.hsetnx(meta(queue), 'password', password);
  if (!created) {
    return false;
  }
  await redis
    .multi()
    .expire(meta(queue), QUEUE_TTL_SECONDS)
    .zadd(queue, 1, 'Start Queue')
    .expire(queue, QUEUE_TTL_SECONDS)
    .geoadd('queues', longitudeCenter, latitudeCenter, queue)
    .exec();
  console.log({EventName: 'created queue', queue});
  return true;
}

async function getPosition(queue, userId) {
  return await redis.zrank(queue, userId);
}

async function getClosestQueues(plusCode) {
  const {latitudeCenter, longitudeCenter} = decodePlusCode(plusCode);
  const closest = await redis.geosearch(
    'queues',
    'FROMLONLAT',
    longitudeCenter,
    latitudeCenter,
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
  decodePlusCode,
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
