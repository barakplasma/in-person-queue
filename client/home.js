/**
 * @type {import('socket.io-client')} io
 */
io;

const homeSocket = io(`${config['socket.io server host']}/`);

function gotoPage(pageName, currentOpenLocationCode) {
  let goto = new URL(location.href);
  goto.pathname = `${location.pathname}${pageName}.html`;
  goto.search = `location=${currentOpenLocationCode}`;
  location.href = goto.toString();
}

function redirectToQueuePage(q) {
  gotoPage('queue', q);
}

function redirectToAdminPage(q) {
  gotoPage('admin', q);
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject('Geolocation is not supported by your browser')
    } else {
      function success(position) {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const currentOpenLocationCode = OpenLocationCode.encode(latitude, longitude);
        let queue = btoa(currentOpenLocationCode);
        resolve(queue);
      }

      function error() {
        reject('Unable to retrieve your location');
      }

      navigator.geolocation.getCurrentPosition(success, error);
    }
  })
}

function redirectToQueue() {
  getLocation().then(redirectToQueuePage);
}

function createQueue() {
  getLocation().then((queue) => {
    homeSocket.emit('create-queue', queue, () => {
      redirectToAdminPage(queue);
    });
  });
}