const RedisLib = require('ioredis');
const REDIS_CONNECTION_STRING = process.env.REDIS_CONNECTION_STRING;
const OpenLocationCode = require('open-location-code/js/src/openlocationcode');

const redis = new RedisLib(REDIS_CONNECTION_STRING);

redis.defineCommand('addToEndOfQueue', {
  numberOfKeys: 1,
  lua: `
    local lastInQueue = redis.call('zrevrange', KEYS[1], 0, 0, 'WITHSCORES');
    local lastInQueueScore = tonumber(lastInQueue[2]) or 0;
    local newLastInQueueScore = lastInQueueScore+1;
    redis.call('zadd', KEYS[1], newLastInQueueScore, ARGV[1]);
    return newLastInQueueScore;
  `,
});

async function addUserToQueue(queue, userId) {
  const userNotInListYet = await userNotInList(queue, userId);
  if (userNotInListYet) {
    return await redis['addToEndOfQueue'](queue, userId).then(
        (endOfQueueScore) => {
          console.log({
            EventName: 'added to queue',
            queue,
            userId,
            endOfQueueScore,
          });
        },
    );
  } else {
    const log = {EventName: 'user already in queue', queue, userId};
    console.log(log);
    return Promise.resolve(log);
  }
}

async function removeUserFromQueue(queue, userId) {
  return await redis.zrem(queue, userId).then((res) => {
    console.log({
      EventName: 'removed from queue',
      removed: res,
      queue,
      userId,
    });
  });
}

async function createQueue(queue, password) {
  await updateQueueMetadata({queue, password});
  const {latitudeCenter = 0, longitudeCenter = 0} = OpenLocationCode.decode(
      queue.split(':')[1],
  );
  await redis.geoadd('queues', longitudeCenter, latitudeCenter, queue);
  return await redis.zadd(queue, [1, 'Start Queue']).then((_) => {
    console.log({EventName: 'created queue', queue});
  });
}

async function userNotInList(queue, userId) {
  const notInList = (await redis.zscore(queue, userId)) == null;
  return notInList;
}

async function getPosition(queue, userId) {
  const position = await redis.zrank(queue, userId);
  return position;
}

async function getClosestQueues(plusCode) {
  const {latitudeCenter = 0, longitudeCenter = 0} = OpenLocationCode.decode(
      Buffer.from(plusCode, 'base64').toString(),
  );
  const closestQueues = await redis.geosearch(
      'queues',
      'FROMLONLAT',
      longitudeCenter,
      latitudeCenter,
      'BYRADIUS',
      100000,
      'm',
      'COUNT',
      5,
      'ASC',
      'WITHDIST',
  );
  return closestQueues.map((q) => ({
    queue: Buffer.from(q[0].split(':')[1], 'utf-8').toString('base64'),
    distance: q[1],
  }));
}

async function getQueueLength(queue) {
  const queueLength = await redis.zcard(queue);
  return queueLength;
}

async function getHeadOfQueue(queue) {
  const headOfQueue = await redis.zrange(queue, 0, 0);
  return headOfQueue[0];
}

async function shiftQueue(queue) {
  return await redis.zpopmin(queue);
}

async function checkAuthForQueue({queue, password}) {
  return (await getQueueMetadata(queue)).password === password;
}

async function getQueueMetadata(queue) {
  return await redis.hgetall('qm:' + queue);
}

/**
 * @typedef {{ queue: string, adminMessage?: string, password?: string}} QueueMetadata
 */
/**
 * @param {QueueMetadata} param0
 */
async function updateQueueMetadata({queue, adminMessage, password}) {
  const changes = Object.assign(
      {},
    adminMessage ? {adminMessage: adminMessage} : null,
    password ? {password: password} : null,
  );

  return await redis.hset('qm:' + queue, changes);
}

module.exports = {
  addUserToQueue,
  removeUserFromQueue,
  createQueue,
  getPosition,
  getQueueLength,
  getHeadOfQueue,
  shiftQueue,
  checkAuthForQueue,
  updateQueueMetadata,
  getQueueMetadata,
  getClosestQueues,
  _redis: redis,
};
