// / <reference types="globals.d.ts">

let queue;
export const urlSearchParams = new URLSearchParams(location.search);
const env = localStorage.getItem('env') || 'prod';
export const config = {
  'socket.io server host': {
    prod: 'chisoonnumber.fly.dev',
    test: localStorage.getItem('test host') || 'localhost:3000',
  }[env],
};

export function getQueueFromAddressOrCache() {
  if (!queue) {
    const location = urlSearchParams.get('location');
    queue = location;
  }
  return queue;
}

export function displayLocation() {
  const fixed = atob(getQueueFromAddressOrCache()).replace(' ', '+');
  // protect against XSS or invalid locations
  // @ts-ignore
  // eslint-disable-next-line no-undef
  if (OpenLocationCode.isValid(fixed)) {
    updateHTML(
        '#location',
        `<a target="_blank" href="https://plus.codes/${fixed}">${fixed}</a>`,
    );
  }
}

export function generateUserId() {
  const distinguishableCharacters = 'CDEHKMPRTUWXY012458'.split('');
  const lenDistinguishableCharacters = distinguishableCharacters.length;
  const userId = crypto
      .getRandomValues(new Uint8ClampedArray(6))
      .reduce(
          (acc, n) =>
            acc + distinguishableCharacters[n % lenDistinguishableCharacters],
          '',
      );
  return userId;
}

export function updateHTML(selector, value) {
  document.querySelector(selector).innerHTML = value;
}

export function vibrate() {
  if (navigator.vibrate) {
    navigator.vibrate(200);
  }
}

export function iAmDoneRedirect() {
  location.href =
    location.origin +
    location.pathname.replace(/\/queue\.html|\/admin\.html/, '');
}
