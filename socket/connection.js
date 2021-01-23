const { addUserToQueue, removeUserFromQueue, createQueue, getPosition, getQueueLength, getHeadOfQueue, shiftQueue } = require('../queue/queue');

function decodeQueue (queueInBase64) {
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

  perQueueAdminNamespace.on('connection', (adminSocket) => {
    console.log('admin connected');
    adminSocket.on('refresh-queue', async (queue, ack) => {
      const queueLength = await getQueueLength(decodeQueue(queue));
      const headOfQueue = await getHeadOfQueue(decodeQueue(queue));
      ack({ queueLength, headOfQueue });
    })

    adminSocket.on('admin-done', async (queue, ack) => {
      console.log({EventMessage: 'admin quit', queue: decodeQueue(queue)})
      ack();
    })

    adminSocket.on("current-user-done", async (queue, ack) => {
      const userRemoved = await shiftQueue(decodeQueue(queue));
      console.log({EventMessage: 'current-user-done', queue: decodeQueue(queue), userRemoved});
      ack();
    })
  });


  function checkAdminAuth(socket, next) {
    const err = new Error("not authorized");
    err.data = { content: "Please retry later" }; // additional details
    next(err);
  }

  // perQueueAdminNamespace.use(checkAdminAuth);

  const namespaceSplitter = /^\/queue\/.+$/;
  const perQueueNamespace = io.of(namespaceSplitter);

  perQueueNamespace.on('connection', (socket) => {
    let userId;
    let queue = socket.nsp.name.split('/')[2];

    socket.on('get-my-position', async (queue, userId, ack) => {
      const currentPosition = await getPosition(decodeQueue(queue), userId);
      const queueLength = await getQueueLength(decodeQueue(queue));
      ack({ currentPosition, queueLength });
    });

    socket.on('add-user', async (queue, userId, ack) => {
      userId = userId;
      await addUserToQueue(decodeQueue(queue), userId);
      ack();
    });

    socket.on('user-done', async (queue, id, ack) => {
      await removeUserFromQueue(decodeQueue(queue), id);
      socket.broadcast.emit('queue-changed');
      ack();
    });

    socket.on('get-queue-length', async (queue, ack) => {
      const queueLength = await getQueueLength(decodeQueue(queue));
      ack({ queueLength });
    });

    socket.on('disconnect', () => {

    });
  });
}
