const crypto = require('crypto');
const { addUserToQueue, removeUserFromQueue, createQueue, getPosition, getQueueLength, getHeadOfQueue, shiftQueue, checkAuthForQueue } = require('../queue/queue');

function decodeQueue(queue) {
  return 'q:' + Buffer.from(queue, 'base64').toString('utf8');
}

module.exports.connection = function (server) {
  /**
   * @type {import('socket.io').Server} io
   */
  const io = require('socket.io')(server, {
    cors: {
      origin: JSON.parse(process.env.CORS_ORIGIN || '["localhost:8080"]'),
      methods: ["GET", "POST"],
    }
  });

  io.on('connection', (socket) => {
    socket.on('create-queue', async (queue, password, ack) => {
      await createQueue(decodeQueue(queue), password);
      ack();
    });
  })

  const roomNamespace = io.of('/room');
  /**
   * 
   * @param {import('socket.io').Socket} roomSocket 
   */
  const roomConnection = (roomSocket) => {
    let queueCache;
    function log(msg, other) {
      console.log(Object.assign({
        EventMessage: msg,
        queue: queueCache,
      }, other))
    }

    roomSocket.on('join-queue', async (queue, type) => {
      queueCache = decodeQueue(queue);
      roomSocket.join(queueCache);
      log('person joined', { type });
    })

    async function refreshQueue() {
      const queueLength = await getQueueLength(queueCache);
      roomSocket.to(queueCache).emit('refresh-queue', queueLength);
      log('refreshed-queue', { queueLength })
    }

    roomSocket.on('get-queue-length', async (ack) => {
      const queueLength = await getQueueLength(queueCache);
      ack(queueLength);
    });

    roomSocket.on('add-to-queue', refreshQueue);

    roomSocket.on('remove-from-queue', refreshQueue);
  }

  roomNamespace.on('connection', roomConnection);

  const adminNamespace = io.of('/admin');

  /**
   * 
   * @param {import('socket.io').Socket} adminSocket 
   */
  const adminConnection = (adminSocket) => {
    let queueCache;
    function log(msg, other) {
      console.log(Object.assign({
        EventMessage: msg,
        queue: queueCache,
      }, other))
    }

    const updateQueueForAdmin = async (ack) => {
      const headOfQueue = await getHeadOfQueue(queueCache);
      ack({ headOfQueue });
      log('admin refresh', { headOfQueue })
    }

    adminSocket.on("update-admin-message", (text, ack) => {
      ack();
      log('received admin message update', { text });
    })

    adminSocket.on('refresh-queue', updateQueueForAdmin);

    adminSocket.on('admin-done', async (ack) => {
      ack();
      log('admin quit')
    })

    adminSocket.on('join-queue', (queue) => {
      queueCache = decodeQueue(queue);
    });

    adminSocket.on("current-user-done", async (ack) => {
      const userRemoved = await shiftQueue(queueCache);
      ack();
      log('current-user-done', { userRemoved });
    })
  }
  adminNamespace.on('connection', adminConnection);


  /**
   * 
   * @param {import('socket.io').Socket} socket 
   * @param {Function} next 
   */
  function checkAdminAuthMiddleware(socket, next) {
    if (socket.handshake.auth.queue && socket.handshake.auth.queue && checkAuthForQueue(socket.handshake.auth)) {
      console.log(socket.handshake.auth)
      next();
    } else {
      const err = new Error("not authorized");
      err.data = { content: "Please retry later" }; // additional details
    }
  }

  adminNamespace.use(checkAdminAuthMiddleware);

  const userNamespace = io.of('/user');
  /**
   * 
   * @param {import('socket.io').Socket} userSocket 
   */
  const userConnection = (userSocket) => {
    let userCache;
    let queueCache;

    function log(msg, other) {
      console.log(Object.assign({
        EventMessage: msg,
        queue: queueCache,
        userId: userCache,
      }, other))
    }

    userSocket.on('join-queue', (queue, userId) => {
      userCache = userId;
      queueCache = decodeQueue(queue);
      log('user-joined-queue')
    });

    const updateMyPosition = async (ack) => {
      const currentPosition = await getPosition(queueCache, userCache);
      ack({ currentPosition });
      log('user-update-position', { currentPosition })
    };

    userSocket.on('get-my-position', updateMyPosition);

    userSocket.on('add-user', async (queue, userId, ack) => {
      queueCache = decodeQueue(queue);
      userCache = userId;
      await addUserToQueue(queueCache, userCache);
      ack();
      log('user-self-add')
    });

    userSocket.on('user-done', async (ack) => {
      await removeUserFromQueue(queueCache, userCache);
      ack();
      log('user-self-done')
    });

    userSocket.on('disconnect', () => {

    })
  };
  userNamespace.on('connection', userConnection);
}
