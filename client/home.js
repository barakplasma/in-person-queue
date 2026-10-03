import {api, setText} from './sharedClientUtils.js';

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

async function showNearbyQueues() {
  const queues = await api(`/queues?${new URLSearchParams({near: await getLocation()})}`);
  if (queues.error) throw Error(queues.error);
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
    row.insertCell().textContent = formatDistance(distance);
  }
}

/** @param {number} meters */
function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

// the closing-time picker starts at 24 hours from now, in local time
const closesInput = document.querySelector('#closes');
const tomorrow = new Date(Date.now() + 24 * 3600_000);
closesInput.value = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000)
  .toISOString()
  .slice(0, 16);

async function createQueue() {
  const closes = new Date(closesInput.value); // datetime-local is local time
  if (isNaN(closes)) return alert('Pick when the queue closes');
  const {error, location, password} = await api('/queues', {
    method: 'POST',
    body: {location: await getLocation(), closes: closes.toISOString()},
  });
  if (error) return alert(error);
  window.location.href = `admin.html?${new URLSearchParams({location, password})}`;
}

showNearbyQueues().catch(console.error);
document.querySelector('#becomeAdmin').addEventListener('click', createQueue);
