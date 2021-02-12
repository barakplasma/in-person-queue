let queue;
let urlSearchParams = new URLSearchParams(location.search);
let env = localStorage.getItem('env') || "prod";
let config = {
  "socket.io server host": {
    "prod": "chisoonnumber.fly.dev",
    "test": localStorage.getItem('test host') || 'localhost:3000'
  }[env]
};

function getQueue() {
  if (!queue) {
    const location = urlSearchParams.get('location');
    queue = location;
  }
  return queue;
}

function displayLocation() {
  const fixed = atob(getQueue()).replace(' ', '+');
  // protect against XSS or invalid locations
  if(OpenLocationCode.isValid(fixed)) {
    updateHTML('#location', `<a target="_blank" href="https://plus.codes/${fixed}">${fixed}</a>`);
  }
}

function updateHTML(selector, value) {
  document.querySelector(selector).innerHTML = value;
}