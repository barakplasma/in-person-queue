const { addUserToQueue, removeUserFromQueue, createQueue, getPosition, getQueueLength, getHeadOfQueue, shiftQueue } = require('../queue/queue');

function decodeQueue(queueInBase64) {
  return Buffer.from(queueInBase64, 'base64').toString('utf8');
}

function catchError(err) {
  console.error(err);
  throw err;
}

module.exports.connection = function (server) {
  /**
   * @type {import('socket.io').Server} io
   */
  const io = require('socket.io')(server, {
    cors: {
      origin: JSON.parse(process.env.CORS_ORIGIN),
      methods: ["GET", "POST"],
    }
  });

  io.on('connection', (socket) => {
    socket.on('create-queue', async (queue, ack) => {
      await createQueue(decodeQueue(queue));
      ack(decodeQueue(queue));
    });

    socket.on('join-queue', async (queue, ack) => {
      ack(decodeQueue(queue));
    });
  })

  const adminNamespace = /^\/admin\/.+$/;
  const perQueueAdminNamespace = io.of(adminNamespace);

  /**
   * 
   * @param {import('socket.io').Socket} adminSocket 
   */
  const adminConnection = (adminSocket) => {
    let queue = decodeQueue(adminSocket.nsp.name.split('/')[2])
    console.log({ EventMessage: 'admin connected', queue });
    adminSocket.join(queue);

    const updateQueueForAdmin = async (queue, ack) => {
      const queueLength = await getQueueLength(decodeQueue(queue));
      const headOfQueue = await getHeadOfQueue(decodeQueue(queue));
      ack({ queueLength, headOfQueue });
    }

    adminSocket.on('refresh-queue', updateQueueForAdmin);

    adminSocket.on('admin-done', async (queue, ack) => {
      perQueueNamespace.to(queue).emit('admin-done');
      console.log({ EventMessage: 'admin quit', queue: decodeQueue(queue) })
      ack();
    })

    adminSocket.on("current-user-done", async (queue, ack) => {
      const userRemoved = await shiftQueue(decodeQueue(queue));
      ack();
      perQueueNamespace.to(queue).emit('queue-changed');
      console.log({ EventMessage: 'current-user-done', queue: decodeQueue(queue), userRemoved });
    })
  }
  perQueueAdminNamespace.on('connection', adminConnection);


  function checkAdminAuth(socket, next) {
    const err = new Error("not authorized");
    err.data = { content: "Please retry later" }; // additional details
    next(err);
  }

  // perQueueAdminNamespace.use(checkAdminAuth);

  const namespaceSplitter = /^\/queue\/.+$/;
  const perQueueNamespace = io.of(namespaceSplitter);
  /**
   * 
   * @param {import('socket.io').Socket} userSocket 
   */
  const userConnection = (userSocket) => {
    let userId;
    let queue = decodeQueue(userSocket.nsp.name.split('/')[2]);
    console.log({ EventMessage: 'user connected', queue });
    userSocket.join(queue);

    const updateMyPosition = async (queue, userId, ack) => {
      const currentPosition = await getPosition(decodeQueue(queue), userId);
      const queueLength = await getQueueLength(decodeQueue(queue));
      ack({ currentPosition, queueLength });
    };

    userSocket.on('get-my-position', updateMyPosition);

    userSocket.on('add-user', async (queue, userId, ack) => {
      userId = userId;
      await addUserToQueue(decodeQueue(queue), userId);
      perQueueAdminNamespace.to(queue).emit('queue-changed')
      ack();
    });

    userSocket.on('queue-changed', () => updateMyPosition(queue, userId));

    userSocket.on('user-done', async (queue, id, ack) => {
      await removeUserFromQueue(decodeQueue(queue), id);
      userSocket.broadcast.emit('queue-changed');
      perQueueAdminNamespace.to(queue).emit('queue-changed')
      ack();
    });

    userSocket.on('get-queue-length', async (queue, ack) => {
      const queueLength = await getQueueLength(decodeQueue(queue));
      ack({ queueLength });
    });

    userSocket.on('disconnect', () => {

    })
  };
  perQueueNamespace.on('connection', userConnection);
}
