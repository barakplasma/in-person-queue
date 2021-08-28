/// <reference types="globals.d.ts">

let queue;
let urlSearchParams = new URLSearchParams(location.search);
let env = localStorage.getItem('env') || "prod";
let config = {
  "socket.io server host": {
    "prod": "chisoonnumber.fly.dev",
    "test": localStorage.getItem('test host') || 'localhost:3000'
  }[env]
};

function getQueueFromAddressOrCache() {
  if (!queue) {
    const location = urlSearchParams.get('location');
    queue = location;
  }
  return queue;
}

function displayLocation() {
  const fixed = atob(getQueueFromAddressOrCache()).replace(' ', '+');
  // protect against XSS or invalid locations
  if(OpenLocationCode.isValid(fixed)) {
    updateHTML('#location', `<a target="_blank" href="https://plus.codes/${fixed}">${fixed}</a>`);
  }
}

function generateUserId() {
  const distinguishableCharacters = 'CDEHKMPRTUWXY012458'.split('');
  const lenDistinguishableCharacters = distinguishableCharacters.length;
  const userId = crypto.getRandomValues(new Uint8ClampedArray(6)).reduce((acc, n) => acc + distinguishableCharacters[n % lenDistinguishableCharacters], "");
  return userId;
}

function updateHTML(selector, value) {
  document.querySelector(selector).innerHTML = value;
}

function iAmDoneRedirect() {
  location.href = location.origin+location.pathname.replace(/\/queue\.html|\/admin\.html/, '');
}