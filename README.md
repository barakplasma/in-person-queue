![CI](https://github.com/barakplasma/in-person-queue/actions/workflows/ci.yml/badge.svg)
![Code Size](https://img.shields.io/github/languages/code-size/barakplasma/in-person-queue)
![GitHub package.json version](https://img.shields.io/github/package-json/v/barakplasma/in-person-queue)
![GitHub Repo stars](https://img.shields.io/github/stars/barakplasma/in-person-queue?style=social)
![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&up_color=blue&up_message=online&url=https%3A%2F%2Fbarakplasma.github.io%2Fin-person-queue%2Fclient%2F)

# in-person-queue

- [Client without active Socket.io Server](https://barakplasma.github.io/in-person-queue/client/)
- [Repository](https://github.com/barakplasma/in-person-queue)
- [Development](#development)

## What is this?

TL:DR; This is a full stack website & server **solution for enabling arbitrary administrators to create location based queues with real-time updates**.

On hold - nearly archived it

## Inspiration

Due to COVID-19, there is a worldwide effort to provide vaccinations to every person on earth. The vaccines currently available must be administered by medical professionals, typically in non-traditional environments (outdoors in places with enough space to socially distance). People are told to patiently queue up (line up) for their vaccine. **We can do better than forcing people to stand in line in order to get vaccinated.**

Instead, there should be a mobile website for people to keep track of their position in a queue. The mobile website should have real-time updates, should work on any internet-enabled phone, and should respect the user's privacy and data. This project aspires to fulfill this need.

If you'd like to keep reading see "Use cases part II" below

## Use cases part II

The Pfizer-BioNTech COVID-19 Vaccine 💉 has a shelf life of 2-8 hours after a carton of doses has been thawed [[citation]](https://www.fda.gov/media/144413/download). Typically, medical professionals thaw and prepare enough doses for everyone with an appointment. However, not everyone with an appointment is ultimately able to show up to their appointments. Thus, there are typically a number of leftover vaccine doses which go to waste every day.

**It is better to make leftover and soon-to-expire vaccine doses available to a nearby waiting list of people desiring vaccination than it is to let them go to waste.**

In Israel 🇮🇱 , there has been a grassroots effort to prevent wasting these leftover doses. In practice, people without appointments queue up at vaccination locations at the end of the day in hopes of getting a vaccine dose from a leftover dose. Medical professionals triage the people in the leftover doses queue according to their risk factors, and provide any leftover doses in order of medical need.

The major problem I noticed while waiting in one of these queues is that it's hard to socially distance while trying to sign up on a single paper waiting list. Then, the medical professional needs to shout out names or numbers, which forces people to stay very close together. This project aspires to enable proper social distancing for people in these queues, or even to check on a queue's length before leaving their home.

An intended use case of this project is to enable medical professionals, or the people in the queue themselves, to organize the queue digitally and easily.

## User Guide

[Implemented: Create queue] Navigate to an instance of In-Person-Queue, such as https://barakplasma.github.io/in-person-queue/client/ and click on "Create queue at my location". By creating a queue, you gain access to administer that queue.
This prompts the browser to ask permission to do a geolocation check. The queue is named after that location as `lat,lon`, rounded to 4 decimals (about 11 meters), so a second admin at the same spot joins the existing queue instead of creating a duplicate. Only the queue admin must provide geolocation access.

[Implemented: ADMIN URL]
Anyone with the admin URL can act as an admin. The admin URL for a queue is a secret for controlling the queue.

[Implemented: ADMIN MESSAGING] An admin can set and update a queue message / title to "shout" to people waiting in that queue. This is a one-to-many communication channel.

[Implemented: SEE NEARBY QUEUES]
People can click "Join a nearby queue" to see a list of nearby queues.

[Implemented: open existing queue] Alternatively, they can navigate to a queue URL (for example https://barakplasma.github.io/in-person-queue/client/queue.html?location=8G4P3QJJ+56) to join that existing queue.

[TODO: QUEUE STATS] On the queue page, a user can see the current length of the queue. A user can see an estimated waiting time, and the configured capacity of the queue. (it isn't practical to provide an infinite queue with long wait times)

## Deployment / Hosting / Ops

This project is built to be self-hosted. There are no cloud dependencies and no third-party requests from the browser. You'll need:

- Node.js 22.9+ (or just Docker)
- Redis 6.2+ or [Valkey](https://valkey.io) (any version)
- a domain name with HTTPS (browsers only allow geolocation on HTTPS or localhost)

### Quickest: Docker Compose

```sh
git clone https://github.com/barakplasma/in-person-queue.git
cd in-person-queue
docker compose up --build
```

Then open http://localhost:8080. Put any TLS reverse proxy in front of it (e.g. `caddy reverse-proxy --to localhost:8080`).

### Prebuilt image (amd64 + arm64)

Every push to `main` publishes `ghcr.io/barakplasma/in-person-queue:latest`. Run it next to any Redis/Valkey:

```sh
docker run -p 8080:8080 -e REDIS_CONNECTION_STRING=redis://my-valkey:6379 ghcr.io/barakplasma/in-person-queue
```

It is a single stateless container listening on `8080` with a `/healthcheck` endpoint (503 until Redis is ready).

### Kubernetes / k3s (Helm)

The chart is published to GHCR as an OCI artifact. By default it also runs Valkey, with a generated password and a 1Gi PVC:

```sh
helm install queue oci://ghcr.io/barakplasma/charts/in-person-queue \
  --namespace queue --create-namespace \
  --set ingress.enabled=true --set ingress.host=queue.example.com --set ingress.tlsSecretName=queue-tls
```

On k3s the default Traefik ingress handles websockets as-is. To use your own Redis/Valkey instead, set `valkey.enabled=false` and either `externalRedis.url` or `externalRedis.existingSecret`. See [`charts/in-person-queue/values.yaml`](charts/in-person-queue/values.yaml) for everything else. More than one app replica needs sticky sessions on the ingress.

### Fly.io

`fly.toml` is included: `fly deploy`, then `fly secrets set REDIS_CONNECTION_STRING=...`.

### Environment Variables

All optional. `npm start` also reads them from a `.env` file.

```env
PORT=3000
REDIS_CONNECTION_STRING=redis://:PASSWORD@HOSTNAME:6379   # default: localhost:6379
CORS_ORIGIN='["https://barakplasma.github.io"]'          # only needed if the client is hosted on another origin
```

Queues expire 24 hours after they are created.

## Development

### Goals

- The most important goal of this project is to enable an ordinary person to create a vaccine leftover queue extremely quickly and easily.
- This project should stay SIMPLE to use and implement. I want any beginner to be able to fork/hack this project to fit their needs. The only simpler alternative to this project should be a paper/pencil/clipboard and a loud voice. See http://boringtechnology.club/ for more details
- The front end must be **accessible**, fast, and work on almost any MOBILE browser.
- The backend should be easy to self-host, and scale nicely. The backend should be easy to host on a Raspberry Pi, a digital ocean droplet, or a full cluster on EC2 / K8s. This means the backend should be high performance, and simple.
- I respect DevOps, but this project should be NoOps. An operator should ideally be able to set it up on a brand new rasberry pi once and never login to it again.

### Technical Design

Vanilla HTML/JavaScript/CSS front-end (no build step, no framework), and a Node.js `http` + Socket.io backend with a Redis/Valkey datastore. Its only runtime dependencies are `socket.io` and `ioredis`.

A queue is named after where the admin created it, as `lat,lon` rounded to 4 decimals (e.g. `32.0800,34.7800`). Each queue is a sorted set (`q:<lat,lon>`), its password and admin message live in a hash (`qm:q:<lat,lon>`), and a geo index (`queues`) powers "nearby queues". The server pushes a `refresh-queue` event to everyone watching a queue whenever it changes.

```mermaid
sequenceDiagram
  participant A as Admin page
  participant S as Server
  participant R as Redis / Valkey
  participant U as User page
  A->>S: create-queue(lat,lon, password)
  S->>R: HSETNX password, ZADD "Start Queue", GEOADD
  U->>S: /room join-queue(lat,lon)
  U->>S: add-user(lat,lon, userId)
  S->>R: addToEndOfQueue (Lua, atomic)
  S-->>U: refresh-queue {queueLength, adminMessage}
  S-->>A: refresh-queue
  A->>S: /admin current-user-done (auth: password)
  S->>R: ZPOPMIN
  S-->>U: refresh-queue (everyone re-reads their position)
```

The client can be hosted as static files anywhere: by default it talks to the server it was loaded from; set `localStorage.setItem('backend', 'https://your-server')` to point it elsewhere (and set `CORS_ORIGIN` on the server).

### Getting started with localhost

```sh
docker compose up -d valkey   # or any local redis on :6379
npm install
npm run dev                   # restarts on file changes
```

Visit http://localhost:3000. Use the "Launch server" VS Code config to debug.

### Tests

Tests need a Redis/Valkey on `REDIS_CONNECTION_STRING` (default `localhost:6379`). They never flush the database.

- `npm test` runs everything
- `npm run test:unit` runs the `node:test` unit tests in `test/`
- `npm run test:e2e` runs the Playwright browser tests in `e2e/` (starts the server for you; run `npx playwright install chromium` once)
- `npm run lint` formats and lints

#### Keywords / Buzzwords

- WebSockets
- Socket.io
- Redis
- Vanilla.js
- Docker
- Fly.io

<div>Some Icons made by <a href="https://www.freepik.com" title="Freepik">Freepik</a> from <a href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a></div>
