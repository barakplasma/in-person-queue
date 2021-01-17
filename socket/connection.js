const { addUserToQueue, removeUserFromQueue, createQueue, getPosition } = require('../queue/queue');

module.exports.connection = function (http) {
  const io = require('socket.io')(http);

  io.on('connection', (socket) => {
    // console.log('a user connected');

    function updateQueueMembers(queue) {
      socket.volatile.to(queue).emit('queue-changed');
    }

    socket.on('get-my-position', async (queue, userId, ack) => {
      const currentPosition = await getPosition(queue, userId);
      lastPosition = currentPosition;
      console.log({EventName: 'get position', queue, userId, currentPosition});
      ack({currentPosition});
    });

    socket.on('add-user', (queue, userId) => {
      socket.join(queue);
      addUserToQueue(queue, userId);
    });

    socket.on('user-done', (queue, id) => {
      removeUserFromQueue(queue, id);
      updateQueueMembers(queue);
    });

    socket.on('create-queue', createQueue);

    socket.on('disconnect', () => {
      // console.log('a user disconnected');
    });
  });
}
