// / <reference types="globals.d.ts">

import {
  urlSearchParams,
  config,
  updateHTML,
  vibrate,
  getQueueFromAddressOrCache,
} from './sharedClientUtils.js';
import {
  addSelfToQueue,
  iAmDone,
  refreshQueue,
  displayAdminMessage,
  getMyPosition,
} from './user.js';
import {io} from 'https://cdn.skypack.dev/pin/socket.io-client@v4.1.3-lNOiO7KseuUMlZav2OCQ/mode=imports,min/optimized/socket.io-client.js';

export function makeRoomSocket() {
  return io(urlSearchParams.has('location') ?
  `${config['socket.io server host']}/room` :
  `${config['socket.io server host']}/`);
}

const roomSocket = makeRoomSocket();

export function refreshQueueLength() {
  return new Promise((resolve, reject) => {
    roomSocket.emit('get-queue-length', resolve);
    setTimeout(() => reject(Error('timeout queue length')), 5000);
  });
}

document.querySelector('#queueLengthContainer')?.addEventListener(
    'click', refreshQueueLength);

export function refreshAdminMessage() {
  return new Promise((resolve, reject) => {
    roomSocket.emit('get-admin-message', resolve);
    setTimeout(() => reject(Error('timeout admin')), 5000);
  });
}

export function displayQueueLength(msg) {
  const {queueLength} = msg;
  updateHTML('#queueLengthCount', queueLength);
}

roomSocket.on('refresh-queue', ({queueLength, adminMessage})=>{
  displayQueueLength({queueLength});
  displayAdminMessage({adminMessage});
  getMyPosition();
  vibrate();
});

export function joinQueue(type) {
  return new Promise((resolve) => roomSocket
      .emit(
          'join-queue',
          getQueueFromAddressOrCache(),
          type,
          resolve,
      ));
}

function join() {
  addSelfToQueue();
  refreshQueue();
}
document.querySelector('#join-queue')?.addEventListener('click', join);
document.querySelector('#refresh-queue')?.
    addEventListener('click', refreshQueue);
document.querySelectorAll('.done').forEach((d) => d.
    addEventListener('click', iAmDone));
