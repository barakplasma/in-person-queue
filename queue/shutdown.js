// see https://github.com/godaddy/terminus/blob/master/example/redis/index.js for inspiration

const _redis = require('./queue')._redis;
const http = require('http');

const PORT = process.env.PORT || "3000";

/**
 * Make a server-side request; similar to Got
 * @param {URL} url 
 * @returns {Promise<{statusCode: number, url: URL}>}
 */
const getStatusOfUrl = url => new Promise((resolve, rejects) => {
  http.get(url, (res) => {
    const { statusCode } = res;
    if (statusCode === 200) {
      resolve({ statusCode, url })
    } else {
      rejects({ statusCode, url })
    }
  })
})

/**
 * @type {import('@godaddy/terminus').TerminusOptions}
 */
const terminusOptions = {
  onSignal: function () {
    console.log('server is starting cleanup');
    return Promise.all([
      // your clean logic, like closing database connections
      _redis
        .quit()
        .then(() => console.log('redis disconnected'))
        .catch(err => console.error('error during disconnection', err.stack))
    ]);
  },
  onShutdown: function () {
    let shutdownMessage = 'cleanup finished, server is shutting down';
    console.log(shutdownMessage);
    return Promise.resolve(shutdownMessage);
  },
  healthChecks: {
    '/healthcheck': function () {
      return Promise.all([
        getStatusOfUrl(new URL(`http://localhost:${PORT}/`)),
        getStatusOfUrl(new URL(`http://localhost:${PORT}/admin.html`)),
        getStatusOfUrl(new URL(`http://localhost:${PORT}/queue.html`)),
        _redis.status === 'ready' ? Promise.resolve({ 'redis status': _redis.status }) : Promise.reject(new Error(`redis status: ${_redis.status}`))
      ]);
    }
  }
}

module.exports.terminusOptions = terminusOptions;