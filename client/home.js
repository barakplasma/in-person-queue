// / <reference types="globals.d.ts">
import {
  config,
  updateHTML,
} from './sharedClientUtils.js';
// import {} from 'user';
import {io} from 'https://cdn.skypack.dev/pin/socket.io-client@v4.1.3-lNOiO7KseuUMlZav2OCQ/mode=imports,min/optimized/socket.io-client.js';

const homeSocket = io(`${config['socket.io server host']}/`, {
  transports: ['websocket', 'polling'],
});

function gotoPage(pageName, currentOpenLocationCode, password = null) {
  const goto = new URL(location.href);
  goto.pathname = `${location.pathname}${pageName}.html`;
  goto.search = new URLSearchParams({
    location: currentOpenLocationCode,
    password: password ? password : '',
  }).toString();
  location.href = goto.toString();
}

document.addEventListener('DOMContentLoaded', async () => {
  const q = await generateQueueFromLocation();
  homeSocket.emit('get-closest-queues', q, (queues) => {
    const generateTableRow = (queue, distance = '?') => `
      <tr>
      <td><a href="queue.html?location=${queue}">${atob(queue)}</a></td>
      <td>${Math.ceil(parseFloat(distance))} meters</td>
    </tr>
    `;
    const tableRows = queues.map((q) => {
      if (typeof q.queue === 'string' && typeof q.distance === 'string') {
        return generateTableRow(q.queue, q.distance);
      } else {
        console.warn({q, error: 'wrong types for table rows'});
      }
    }).join('\n');
    const html = `
    <table>
      <thead>
        <th>Name</th>
        <th><img src="destination.png" height="30px" alt="Distance"></th>
      </thead>
      ${tableRows}
    </table>
    `;
    updateHTML('#queues', html);
  });
});

function redirectToAdminPage(q, password) {
  gotoPage('admin', q, password);
}

/**
 * @return {Promise<string>}
 */
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Error('Geolocation is not supported by your browser'));
    } else {
      function success(position) {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        resolve([latitude, longitude].join(':'));
      }

      function error() {
        // alert('Unable to retrieve your location');
        updateHTML('#warning',
            '<strong>Unable to retrieve your location</strong>');
        reject(Error('Unable to retrieve your location'));
      }

      navigator.geolocation.getCurrentPosition(success, error);
    }
  });
}

/**
 * @param {string} latLonConcat
 * @return {string}
 */
function generateQueueFromLatLonConcat(latLonConcat) {
  const [latitude, longitude] = latLonConcat.split(':').map(parseFloat);
  const currentOpenLocationCode = OpenLocationCode.encode(latitude, longitude);
  const queue = btoa(currentOpenLocationCode);
  return queue;
}

function generateQueueFromLocation() {
  return getLocation().then(generateQueueFromLatLonConcat);
}

function createQueue() {
  getLocation().then(generateQueueFromLatLonConcat).then((queue) => {
    const password = btoa(
        window.
            crypto
            .getRandomValues(
                new Uint8Array(6),
            ).toString());
    homeSocket.emit('create-queue', queue, password, () => {
      redirectToAdminPage(queue, password);
    });
  });
}

document.querySelector('#becomeAdmin')?.addEventListener('click', createQueue);
