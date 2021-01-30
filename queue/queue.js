const redisLib = require('ioredis');
const REDIS_HOST = process.env.REDIS_HOST || "localhost:6379";

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
  await redis.hset('authorizations', {[queue]: password});
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
  return await redis.hget('authorizations', queue) === password;
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
  _redis: redis,
}