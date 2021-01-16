const { addUserToQueue, removeUserFromQueue, createQueue, getPosition } = require('../queue/queue');

module.exports.connection = function (http) {
  const io = require('socket.io')(http);

  io.on('connection', (socket) => {
    // console.log('a user connected');
    function updateQueueMembers(queue) {
      socket.to(queue).emit('queue-changed');
    }

    socket.on('get-my-position', async (queue, id) => {
      const currentPosition = await getPosition(queue,id);
      socket.emit('update-queue-position', {currentPosition});
    });

    socket.on('add-user', (queue, id) => {
      socket.join(queue);
      addUserToQueue(queue, id);
      updateQueueMembers(queue);
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
