const queues = require('../queue/queue');
const {Server} = require('socket.io');

/**
 * Validates a plus code from a client and returns its redis key.
 * @param {unknown} plusCode
 * @return {string}
 */
function queueKey(plusCode) {
  const code = String(plusCode).toUpperCase();
  queues.decodePlusCode(code); // throws if invalid
  return 'q:' + code;
}

/**
 * Registers a handler that can't crash the process: errors are logged and
 * reported through the ack callback (always the last argument) when present.
 * @param {import('socket.io').Socket} socket
 * @param {string} event
 * @param {(...args: any[]) => Promise<void> | void} handler
 */
function on(socket, event, handler) {
  socket.on(event, async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error({EventMessage: 'handler failed', event, error: error.message});
      const ack = args.at(-1);
      if (typeof ack === 'function') ack({error: error.message});
    }
  });
}

/**
 * @param {import('http').Server} server
 * @return {Server}
 */
module.exports.connection = function (server) {
  const io = new Server(
    server,
    process.env.CORS_ORIGIN
      ? {cors: {origin: JSON.parse(process.env.CORS_ORIGIN), methods: ['GET', 'POST']}}
      : {},
  );
  const rooms = io.of('/room');

  /** Push the latest queue state to everyone watching the queue. */
  async function broadcast(queue) {
    const [queueLength, {adminMessage}] = await Promise.all([
      queues.getQueueLength(queue),
      queues.getQueueMetadata(queue),
    ]);
    rooms.to(queue).emit('refresh-queue', {queueLength, adminMessage});
  }

  io.on('connection', (socket) => {
    on(socket, 'create-queue', async (plusCode, password, ack) => {
      const created = await queues.createQueue(queueKey(plusCode), password);
      ack(created ? {} : {error: 'A queue already exists at this location. Join it instead.'});
    });

    on(socket, 'get-closest-queues', async (plusCode, ack) => {
      ack(await queues.getClosestQueues(queueKey(plusCode).slice(2)));
    });
  });

  rooms.on('connection', (socket) => {
    on(socket, 'join-queue', (plusCode) => socket.join(queueKey(plusCode)));

    on(socket, 'get-queue-length', async (plusCode, ack) => {
      ack({queueLength: await queues.getQueueLength(queueKey(plusCode))});
    });

    on(socket, 'get-admin-message', async (plusCode, ack) => {
      const {adminMessage} = await queues.getQueueMetadata(queueKey(plusCode));
      ack({adminMessage});
    });

    on(socket, 'get-my-position', async (plusCode, userId, ack) => {
      ack({currentPosition: await queues.getPosition(queueKey(plusCode), String(userId))});
    });

    on(socket, 'add-user', async (plusCode, userId, ack) => {
      const queue = queueKey(plusCode);
      await queues.addUserToQueue(queue, String(userId).slice(0, 32));
      ack({});
      await broadcast(queue);
    });

    on(socket, 'user-done', async (plusCode, userId, ack) => {
      const queue = queueKey(plusCode);
      await queues.removeUserFromQueue(queue, String(userId));
      ack({});
      await broadcast(queue);
    });
  });

  const admin = io.of('/admin');

  // The admin namespace is scoped to the queue the password was checked against.
  admin.use(async (socket, next) => {
    try {
      const queue = queueKey(socket.handshake.auth.queue);
      if (await queues.checkAuthForQueue({queue, password: socket.handshake.auth.password})) {
        socket.data.queue = queue;
        return next();
      }
    } catch {
      // invalid plus code: fall through to unauthorized
    }
    next(new Error('not authorized'));
  });

  admin.on('connection', (socket) => {
    const {queue} = socket.data;

    on(socket, 'refresh-queue', async (ack) => {
      ack({headOfQueue: await queues.getHeadOfQueue(queue)});
    });

    on(socket, 'update-admin-message', async (text, ack) => {
      await queues.updateAdminMessage(queue, text);
      ack?.({});
      await broadcast(queue);
    });

    on(socket, 'current-user-done', async (ack) => {
      const userRemoved = await queues.shiftQueue(queue);
      console.log({EventMessage: 'current-user-done', queue, userRemoved});
      ack({});
      await broadcast(queue);
    });
  });

  return io;
};
