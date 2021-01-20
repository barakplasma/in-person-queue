require('dotenv').config()
const PORT = process.env.PORT || "3000";

const { static } = require('express');
const app = require('express')();

const server = require('http').createServer(app);
require('./socket/connection').connection(server);

app.use(static('client'))

app.get('/queue/*', (_, res) => {
  res.sendFile(__dirname + '/client/queue.html');
})

app.route('/').all(static('client'));

server.listen(PORT, () => {
  console.log('listening on *:'+PORT);
});