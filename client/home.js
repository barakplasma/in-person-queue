import {connect, request, setText} from './sharedClientUtils.js';

const homeSocket = connect('');

/** @return {Promise<string>} "lat,lon" of the current location */
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(Error('Geolocation is not supported by your browser'));
    }
    navigator.geolocation.getCurrentPosition(
      ({coords}) => resolve(`${coords.latitude},${coords.longitude}`),
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
  const queues = await request(homeSocket, 'get-closest-queues', await getLocation());
  const tbody = document.querySelector('#queues tbody');
  if (!queues.length) {
    const cell = tbody.insertRow().insertCell();
    cell.colSpan = 2;
    cell.textContent = 'No queues nearby yet';
  }
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
  const password = crypto.randomUUID();
  const {error, location} = await request(
    homeSocket,
    'create-queue',
    await getLocation(),
    password,
  );
  if (error) return alert(error);
  gotoPage('admin', {location, password});
}

showNearbyQueues().catch(console.error);
document.querySelector('#becomeAdmin').addEventListener('click', createQueue);
