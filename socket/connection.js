const { addUserToQueue, removeUserFromQueue, createQueue, getPosition, getQueueLength } = require('../queue/queue');

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
      await createQueue(queue);
      ack();
    });
  })

  const adminNamespace = /^\/admin\/.+$/;
  const perQueueAdminNamespace = io.of(adminNamespace);

  perQueueAdminNamespace.on('connection', (adminSocket) => {
    adminSocket.on('connection', () => {
      console.log('admin connected')
    })
  });


  function checkAdminAuth(socket, next) {
    const err = new Error("not authorized");
    err.data = { content: "Please retry later" }; // additional details
    next(err);
  }
  perQueueAdminNamespace.use(checkAdminAuth);

  const namespaceSplitter = /^\/queue\/.+$/;
  const perQueueNamespace = io.of(namespaceSplitter);

  perQueueNamespace.on('connection', (socket) => {
    let userId;
    let queue = socket.nsp.name.split('/')[2];

    socket.on('get-my-position', async (queue, userId, ack) => {
      const currentPosition = await getPosition(queue, userId);
      ack({ currentPosition });
    });

    socket.on('add-user', async (queue, userId, ack) => {
      userId = userId;
      await addUserToQueue(queue, userId);
      ack();
    });

    socket.on('user-done', async (queue, id, ack) => {
      await removeUserFromQueue(queue, id);
      socket.broadcast.emit('queue-changed');
      ack();
    });

    socket.on('get-queue-length', async (queue, ack) => {
      const queueLength = await getQueueLength(queue);
      ack({ queueLength });
    });

    socket.on('disconnect', () => {

    });
  });
}
