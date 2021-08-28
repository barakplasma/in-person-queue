const redisLib = require('ioredis');
const REDIS_HOST = process.env.REDIS_HOST || "localhost:6379";
const OpenLocationCode = require('open-location-code/js/src/openlocationcode');

const DEFAULT_EXPIRATION = 86400;

const redis = new redisLib(process.env.NODE_ENV == "production" ? process.env.FLY_REDIS_CACHE_URL : `redis://${REDIS_HOST}`);

async function addUserToQueue(queue, userId) {
  const userNotInListYet = await userNotInList(queue, userId);
  if (userNotInListYet) {
    const [endOfQueueUser = "no one in queue", currentEndOfQueueScore = 0] = await redis.zrevrange(queue, 0, 0, "WITHSCORES");
    const endOfQueueScore = +currentEndOfQueueScore + 1;
    return await redis.zadd(queue, [endOfQueueScore, userId])
      .then(() => {
        console.log({ EventName: 'added to queue', queue, userId, endOfQueueScore })
      })
  } else {
    let log = { EventName: 'user already in queue', queue, userId };
    console.log(log)
    return Promise.resolve(log)
  }
}

async function removeUserFromQueue(queue, userId) {
  return await redis.zrem(queue, userId)
    .then((res) => {
      console.log({ EventName: 'removed from queue', removed: res, queue, userId })
    })
}

async function createQueue(queue, password) {
  await updateQueueMetadata({ queue, password });
  let { latitudeCenter = 0, longitudeCenter = 0 } = OpenLocationCode.decode(queue.split(':')[1]);
  await redis.geoadd('queues', longitudeCenter, latitudeCenter, queue);
  return await redis.zadd(queue, [1, 'Start Queue'])
    .then(_ => {
      console.log({ EventName: 'created queue', queue });
    })
}

async function userNotInList(queue, userId) {
  const notInList = await redis.zscore(queue, userId) == null;
  return notInList;
}

async function getPosition(queue, userId) {
  const position = await redis.zrank(queue, userId);
  return position;
}

async function getClosestQueues(plusCode) {
  let { latitudeCenter = 0, longitudeCenter = 0 } = OpenLocationCode.decode(Buffer.from(plusCode, 'base64').toString());
  const closestQueues = await redis.geosearch("queues", "FROMLONLAT", longitudeCenter, latitudeCenter, "BYRADIUS", 1000, 'km', "COUNT", 5, "ASC");
  return closestQueues.map(q => Buffer.from(q.split(':')[1], 'utf-8').toString('base64'));
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

async function checkAuthForQueue({ queue, password }) {
  return (await getQueueMetadata(queue)).password === password;
}

async function getQueueMetadata(queue) {
  return await redis.hgetall('qm:' + queue);
}

/**
 * 
 * @param {{ queue: string, adminMessage?: string, password?: string}} param0 
 */
async function updateQueueMetadata({ queue, adminMessage, password }) {
  const changes = Object.assign({},
    adminMessage ? { 'adminMessage': adminMessage } : null,
    password ? { 'password': password } : null,
  )

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
}