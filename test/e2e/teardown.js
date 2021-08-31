const queue = require('../../queue/queue');

async function teardown() {
  await queue._redis.disconnect();
  await queue._redis.quit();
}

module.exports = async function() {
  await teardown();
};
