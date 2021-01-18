const { addUserToQueue, removeUserFromQueue, createQueue, getPosition } = require('../queue/queue');

module.exports.connection = function (http) {
  const io = require('socket.io')(http, {
    cors: {
      origin: "https://barakplasma.github.io",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    socket.on('create-queue', createQueue);
  })

  // working '/queue/8G4P3RG3+JM'
  const namespaceSplitter = /^\/queue\/.+$/;
  const perQueueNamespace = io.of(namespaceSplitter);

  perQueueNamespace.on('connection', (socket) => {
    let userId;
    let queue = socket.nsp.name.split('/')[2];

    socket.on('get-my-position', async (queue, userId, ack) => {
      const currentPosition = await getPosition(queue, userId);
      lastPosition = currentPosition;
      ack({ currentPosition });
    });

    socket.on('add-user', (queue, userId) => {
      addUserToQueue(queue, userId);
      userId = userId;
    });

    socket.on('user-done', (queue, id, ack) => {
      removeUserFromQueue(queue, id);
      socket.broadcast.emit('queue-changed');
      ack();
    });

    socket.on('disconnect', () => {

    });
  });
}
