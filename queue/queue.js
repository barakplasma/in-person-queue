const redisLib = require('ioredis');
const REDIS_PORT = process.env.REDIS_PORT;
const REDIS_HOST = process.env.REDIS_HOST;

const redis = new redisLib(REDIS_PORT, REDIS_HOST);

async function addUserToQueue(queue, id) {
  console.log({EventName: 'adding to queue', queue, id});
  await redis.rpush(queue, id).then((res) => {
    console.log({EventName: 'added to queue', queueLength: res, queue})
  }).catch(console.error);
}

async function removeUserFromQueue(queue, id) {
  console.log({EventName: 'removing from queue', queue, id})
  await redis.lrem(queue, 1, id).then((res) => {
    console.log({EventName: 'removed from queue', queueLength: res, queue})
  }).catch(console.error);
}

async function createQueue(queue) {
  console.log({EventName: 'creating a new queue', queue});
  await redis.lpush(queue, 'Start Queue').then(res => {
    console.log({EventName: 'created queue', queue});
  }).catch(console.error);
}

async function getPosition(queue, id) {
  console.log({EventName: 'getting position', queue, id});
  return await redis.lpos(queue, id);
}

module.exports = {
  addUserToQueue,
  removeUserFromQueue,
  createQueue,
  getPosition,
}