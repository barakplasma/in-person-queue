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

document.addEventListener("DOMContentLoaded", async () => {
  let q = await generateQueueFromLocation();
  homeSocket.emit('get-closest-queues', q, (queues) => {
    let tableRow = (queue, size = '?', distance = '?m') => `
      <tr>
      <td><a href="queue.html?location=${queue}">Vaccine</a></td>
      <td>${size}</td>
      <td>${distance}</td>
    </tr>
    `;
    let html = `
    <table>
      <thead>
        <th>Name</th>
        <th>In queue</th>
        <th><img src="destination.png" height="30px" alt="Distance"></th>
      </thead>
      ${queues.map(q => tableRow(q)).join('\n')}
    </table>
    `
    updateHTML('#queues', html);
  });
});

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
        resolve([latitude,longitude].join(':'));
      }

      function error() {
        // alert('Unable to retrieve your location');
        updateHTML('#warning', '<strong>Unable to retrieve your location</strong>');
        reject('Unable to retrieve your location');
      }

      navigator.geolocation.getCurrentPosition(success, error);
    }
  })
}

/**
 * @param {string} latLonConcat 
 */
function generateQueueFromLatLonConcat(latLonConcat) {
  let [latitude, longitude] = latLonConcat.split(':').map(parseFloat);
  const currentOpenLocationCode = OpenLocationCode.encode(latitude, longitude);
  let queue = btoa(currentOpenLocationCode);
  return queue;
}

function generateQueueFromLocation() {
  return getLocation().then(generateQueueFromLatLonConcat);
}

function createQueue() {
  getLocation().then(generateQueueFromLatLonConcat).then((queue) => {
    let password = btoa(window.crypto.getRandomValues(new Uint8Array(6)).toString());
    homeSocket.emit('create-queue', queue, password, () => {
      redirectToAdminPage(queue, password);
    });
  });
}