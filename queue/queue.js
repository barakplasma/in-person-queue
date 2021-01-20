const redisLib = require('ioredis');
const REDIS_PORT = process.env.REDIS_PORT || "6379";
const REDIS_HOST = process.env.REDIS_HOST || "localhost";

const redis = new redisLib(process.env.NODE_ENV == "production" ? process.env.FLY_REDIS_CACHE_URL : `redis://${REDIS_HOST}:${REDIS_PORT}`);

async function addUserToQueue(queue, userId) {
  const userNotInListYet = await userNotInList(queue, userId);
  if (userNotInListYet) {
    const result = await redis.zrevrange(queue, 0, 0, "WITHSCORES");
    console.log({ EventName: 'last person in queue', queue, result});
    const userPosition = parseInt(result[1])+1;
    return await redis.zadd(queue, [userPosition, userId])
      .then(() => {
        console.log({ EventName: 'added to queue', queue, userId })
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
      console.log({ EventName: 'removed from queue', queueLength: res, queue, userId })
    })
}

async function createQueue(queue) {
  return await redis.zadd(queue, 0, 'Start Queue')
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

module.exports = {
  addUserToQueue,
  removeUserFromQueue,
  createQueue,
  getPosition,
  _redis: redis,
}