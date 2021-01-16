/**
 * @type {import('socket.io-client')} io
 */
io;

const socket = io();

socket.emit('add-user');
let userId = '';
socket.on('user-id-assigned', (newUserId) => {
  userId = newUserId;
})

function createQueue() {
  if(!navigator.geolocation) {
    console.error('Geolocation is not supported by your browser');
  } else {
    function success(position) {
      const latitude  = position.coords.latitude;
      const longitude = position.coords.longitude;
      const currentOpenLocationCode = OpenLocationCode.encode(latitude, longitude);
    
      console.log(`Latitude: ${latitude} °, Longitude: ${longitude} °`);
      console.log(currentOpenLocationCode);

      socket.emit('')
    }
    
    function error() {
      console.error('Unable to retrieve your location');
    }

    navigator.geolocation.getCurrentPosition(success, error);
  }
}


function iAmDone() {
  socket.emit('user-done', id)
}

socket.on('update-queue-position', (msg) => {
  const { newPosition } = msg;
  document.querySelector('#position-in-queue').innerHTML = newPosition;
});