const {
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
} = require('../queue/queue');
const {Server} = require('socket.io');

function decodeQueue(queue) {
  return 'q:' + Buffer.from(queue, 'base64').toString('utf8');
}

/**
 * @typedef {import('socket.io').Socket} Socket
 */

module.exports.connection = function(server) {
  const io = new Server(server, {
    cors: {
      origin: JSON.parse(process.env.CORS_ORIGIN || '["localhost:8080"]'),
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    socket.on('create-queue', async (queue, password, ack) => {
      await createQueue(decodeQueue(queue), password);
      ack();
    });

    socket.on('get-closest-queues', async (queue, ack) => {
      const closestQueues = await getClosestQueues(queue);
      ack(closestQueues);
    });
  });

  const roomNamespace = io.of('/room');
  /**
   * @param {Socket} roomSocket
   */
  const roomConnection = (roomSocket) => {
    let queueCache;
    let userCache;
    function log(msg, other) {
      console.log(
          Object.assign(
              {
                EventMessage: msg,
                queue: queueCache,
              },
              other,
          ),
      );
    }

    roomSocket.on('join-queue', (queue) => {
      try {
        queueCache = decodeQueue(queue);
        roomSocket.join(queueCache);
        log('person joined');
        refreshQueue();
      } catch (error) {
        console.info(queue);
        console.error(error);
      }
    });

    async function refreshQueue() {
      const queueLength = await getQueueLength(queueCache);
      const adminMessage = (await getQueueMetadata(queueCache)).adminMessage;
      const update = {queueLength, adminMessage};
      roomSocket.to(queueCache).emit('refresh-queue', update);
      log('refreshed-queue', update);
    }

    roomSocket.on('get-queue-length', async (queue, ack) => {
      const queueLength = await getQueueLength(decodeQueue(queue));
      ack({queueLength});
    });

    roomSocket.on('get-admin-message', async (queue, ack) => {
      const adminMessage = (await getQueueMetadata(decodeQueue(queue)))
          .adminMessage;
      ack({adminMessage});
    });

    roomSocket.on('add-to-queue', refreshQueue);
    roomSocket.on('refresh-queue', refreshQueue);
    roomSocket.on('remove-from-queue', refreshQueue);

    const updateMyPosition = async (userId, ack) => {
      const currentPosition = await getPosition(queueCache, userId);
      console.debug({currentPosition, userId, queueCache});
      ack({currentPosition});
      log('user-update-position', {currentPosition});
    };

    roomSocket.on('get-my-position', updateMyPosition);

    roomSocket.on('add-user', async (queue, userId, socketId, ack) => {
      queueCache = decodeQueue(queue);
      userCache = userId;
      await addUserToQueue(queueCache, userCache);
      ack();
      log('user-self-add');
      log({socketId});
    });

    roomSocket.on('user-done', async (queue, userId, ack) => {
      await removeUserFromQueue(decodeQueue(queue), userId);
      ack();
      log('user-self-done');
      refreshQueue();
    });

    roomSocket.on('disconnect', () => {
      log(`user disconnected`);
    });
  };

  roomNamespace.on('connection', roomConnection);

  const adminNamespace = io.of('/admin');

  /**
   *
   * @param {Socket} adminSocket
   */
  const adminConnection = (adminSocket) => {
    let queueCache;
    function log(msg, other) {
      console.log(
          Object.assign(
              {
                EventMessage: msg,
                queue: queueCache,
              },
              other,
          ),
      );
    }

    const updateQueueForAdmin = async (ack) => {
      const headOfQueue = await getHeadOfQueue(queueCache);
      ack({headOfQueue});
      log('admin refresh', {headOfQueue});
    };

    adminSocket.on('update-admin-message', async (text) => {
      const newMessage = {queue: queueCache, adminMessage: text};
      await updateQueueMetadata(newMessage);
      log('updated admin message', newMessage);
    });

    adminSocket.on('refresh-queue', updateQueueForAdmin);

    adminSocket.on('admin-done', async (ack) => {
      ack();
      log('admin quit');
    });

    adminSocket.on('join-queue', (queue, ack) => {
      queueCache = decodeQueue(queue);
      ack();
    });

    adminSocket.on('current-user-done', async (ack) => {
      const userRemoved = await shiftQueue(queueCache);
      ack();
      log('current-user-done', {queue: queueCache, userRemoved});
    });
  };
  adminNamespace.on('connection', adminConnection);

  /**
   *
   * @param {Socket} socket
   * @param {Function} next
   */
  function checkAdminAuthMiddleware(socket, next) {
    if (
      socket.handshake.auth.queue &&
      socket.handshake.auth.queue &&
      checkAuthForQueue(socket.handshake.auth)
    ) {
      next();
    } else {
      const err = new Error('not authorized');
      err['data'] = {content: 'Please retry later'}; // additional details
    }
  }

  adminNamespace.use(checkAdminAuthMiddleware);
};
