import {connect, request, setText} from './sharedClientUtils.js';

const homeSocket = connect('');

/** @return {Promise<string>} plus code of the current location */
function getPlusCode() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(Error('Geolocation is not supported by your browser'));
    }
    navigator.geolocation.getCurrentPosition(
      ({coords}) => resolve(OpenLocationCode.encode(coords.latitude, coords.longitude)),
      () => {
        setText('#warning', 'Unable to retrieve your location');
        reject(Error('Unable to retrieve your location'));
      },
    );
  });
}

function gotoPage(pageName, params) {
  location.href = `${pageName}.html?${new URLSearchParams(params)}`;
}

async function showNearbyQueues() {
  const queues = await request(homeSocket, 'get-closest-queues', await getPlusCode());
  const tbody = document.querySelector('#queues tbody');
  for (const {queue, distance} of queues) {
    const row = tbody.insertRow();
    const a = document.createElement('a');
    a.href = `queue.html?${new URLSearchParams({location: queue})}`;
    a.textContent = queue;
    row.insertCell().append(a);
    row.insertCell().textContent = `${Math.ceil(parseFloat(distance))} meters`;
  }
}

async function createQueue() {
  const plusCode = await getPlusCode();
  const password = crypto.randomUUID();
  const {error} = await request(homeSocket, 'create-queue', plusCode, password);
  if (error) return alert(error);
  gotoPage('admin', {location: plusCode, password});
}

showNearbyQueues().catch(console.error);
document.querySelector('#becomeAdmin').addEventListener('click', createQueue);
