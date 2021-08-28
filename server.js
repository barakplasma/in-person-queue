require('dotenv').config();
const PORT = process.env.PORT || '3000';

const {static} = require('express');
const app = require('express')();

const {createTerminus} = require('@godaddy/terminus');
const terminusOptions = require('./queue/shutdown').terminusOptions;

const server = require('http').createServer(app);
require('./socket/connection').connection(server);

app.use(static('client'));

createTerminus(server, terminusOptions);

server.listen(PORT, () => {
  console.log('listening on *:'+PORT);
});
