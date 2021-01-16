const { static } = require('express');
const app = require('express')();
const http = require('http').Server(app);
const PORT = process.env.PORT;
require('./socket/connection').connection(http);

app.use(static('client'))

app.get('/queue/*', (_, res) => {
  res.sendFile(__dirname + '/client/queue.html');
})

http.listen(PORT, () => {
  console.log('listening on *:'+PORT);
});