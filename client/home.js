/// <reference types="globals.d.ts">

const homeSocket = io(`${config['socket.io server host']}/`);

function gotoPage(pageName, currentOpenLocationCode, password = null) {
  let goto = new URL(location.href);
  goto.pathname = `${location.pathname}${pageName}.html`;
  goto.search = new URLSearchParams({
    location: currentOpenLocationCode,
    password: password ? password : '',
  }).toString()
  location.href = goto.toString();
}

function redirectToQueuePage(q) {
  gotoPage('queue', q);
}

function redirectToAdminPage(q, password) {
  gotoPage('admin', q, password);
}

/**
 * 
 * @type {() => Promise<string>}
 */
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
    let password = btoa(window.crypto.getRandomValues(new Uint8Array(6)).toString());
    homeSocket.emit('create-queue', queue, password, () => {
      redirectToAdminPage(queue, password);
    });
  });
}