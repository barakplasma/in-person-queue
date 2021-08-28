require('dotenv').config();
const PORT = process.env.PORT || '3000';

const {static} = require('express');
const app = require('express')();

const {createTerminus} = require('@godaddy/terminus');
const terminusOptions = require('./queue/shutdown').terminusOptions;

const server = require('http').createServer(app);
require('./socket/connection').connection(server);

app.use(static('client'));

app.get('/setBackend', (req, res) => {
  res.send(`<html><script>
    window.localStorage.setItem('env', 'test');
    window.localStorage.setItem('test host', '${req.hostname}');
    </script></html>
  `);
});

createTerminus(server, terminusOptions);

server.listen(PORT, () => {
  console.log('listening on *:'+PORT);
});
