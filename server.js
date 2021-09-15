require('dotenv').config();
const PORT = process.env.PORT || '3000';

const fs = require('fs');
function bareBonesStaticServer(req, res) {
  if (req.url === '/') {
    req.url = 'index.html';
  }
  fs.readFile(
      __dirname + '/client/' + new URL(req.url, 'http://example.com').pathname,
      function(err, data) {
        if (err) {
          res.writeHead(404);
          res.end(JSON.stringify(err));
          return;
        }
        if (req.url.endsWith('.js')) {
          res.setHeader('content-type', 'text/javascript; charset=utf-8');
        }
        res.writeHead(200);
        res.end(data);
      },
  );
}

const {createTerminus} = require('@godaddy/terminus');
const terminusOptions = require('./queue/shutdown').terminusOptions;

const server = require('http').createServer(bareBonesStaticServer);
require('./socket/connection').connection(server);

createTerminus(server, terminusOptions);

server.listen(PORT, () => {
  console.log('listening on *:' + PORT);
});
