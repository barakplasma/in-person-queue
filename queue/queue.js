const redisLib = require('ioredis');
const REDIS_PORT = process.env.REDIS_PORT;
const REDIS_HOST = process.env.REDIS_HOST;

const redis = new redisLib(REDIS_PORT, REDIS_HOST);

function addUserToQueue(id) {
  console.log('adding: ' + id);
  redis.rpush('users', id, (err, res) => {
    if (err) {
      console.error(err)
    }
    console.log('added: ' + res)
  });
}

function removeUserFromQueue(id) {
  console.log('removing: ' + id)
  redis.lrem('users', 1, id, (err, res) => {
    if (err) {
      console.error(err)
    }
    console.log('removed: ' + res)
  });
}

module.exports = {
  addUserToQueue,
  removeUserFromQueue
}