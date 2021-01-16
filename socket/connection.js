const uuid = require('uuid');
const { addUserToQueue, removeUserFromQueue } = require('../queue/queue');

module.exports.connection = function (http) {
  const io = require('socket.io')(http);

  io.on('connection', (socket) => {
    // console.log('a user connected');

    socket.on('add-user', () => {
      const userId = uuid.v4();
      socket.emit('user-id-assigned', userId);
      addUserToQueue(userId);
    })

    socket.on('user-done', (user) => {
      // console.info('a user finished')
      removeUserFromQueue(user)
    })

    socket.on('disconnect', () => {
      // console.log('a user disconnected');
    });
  });
}
