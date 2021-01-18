const redisLib = require('ioredis');
const REDIS_PORT = process.env.REDIS_PORT || "6379";
const REDIS_HOST = process.env.REDIS_HOST || "localhost";

const redis = new redisLib(REDIS_PORT, REDIS_HOST);

async function addUserToQueue(queue, userId) {
  const userNotAlreadyInList = await userNotInList(queue, userId);
  if (userNotAlreadyInList) {
    await redis.rpush(queue, userId).then((res) => {
      console.log({ EventName: 'added to queue', queueLength: res, queue, userId })
    }).catch(console.error);
  }
}

async function removeUserFromQueue(queue, userId) {
  await redis.lrem(queue, 1, userId).then((res) => {
    console.log({ EventName: 'removed from queue', queueLength: res, queue, userId })
  }).catch(console.error);
}

async function createQueue(queue) {
  await redis.lpush(queue, 'Start Queue').then(_ => {
    console.log({ EventName: 'created queue', queue });
  }).catch(console.error);
}

async function userPosition(queue, userId) {
  const position = await redis.lpos(queue, userId);
  return position;
}

async function userNotInList(queue, userId) {
  return (await userPosition(queue, userId)) == null;
}

async function getPosition(queue, userId) {
  return userPosition(queue, userId);
}

module.exports = {
  addUserToQueue,
  removeUserFromQueue,
  createQueue,
  getPosition,
}