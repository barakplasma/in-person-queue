const fs = require('fs');
const { static } = require('express');
const app = require('express')();
const keyPath = process.env.KEY; // for example 'localhost-key.pem'
const certPath = process.env.CERT; // for example 'localhost-cert.pem'
const server = require('https').createServer({
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
}, app);
const PORT = process.env.PORT;
require('./socket/connection').connection(server);

app.use(static('client'))

app.get('/queue/*', (_, res) => {
  res.sendFile(__dirname + '/client/queue.html');
})

server.listen(PORT, () => {
  console.log('listening on *:'+PORT);
});