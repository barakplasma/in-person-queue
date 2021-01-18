require('dotenv').config()
const keyPath = process.env.KEY || "localhost-key.pem";
const certPath = process.env.CERT || "localhost-cert.pem";
const PORT = process.env.PORT || "3000";

const { static } = require('express');
const app = require('express')();

const fs = require('fs');
const server = require('https').createServer({
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
}, app);
require('./socket/connection').connection(server);

app.use(static('client'))

app.get('/queue/*', (_, res) => {
  res.sendFile(__dirname + '/client/queue.html');
})

server.listen(PORT, () => {
  console.log('listening on *:'+PORT);
});