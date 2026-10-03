# ADR 0001: One Go binary, server-sent events, one replica

- Status: Accepted (2026-10-03)

## Context

The app has to be boring and stable:

- easy to self-host on a Raspberry Pi, a small ARM VPS or a k3s cluster;
- simple enough for a beginner to fork;
- built on established projects for anything complex, rather than our own code.

The maintainer prefers Go and runs k3s on an ARM VPS.

The workload is tiny: at most a few thousand queues, each with up to a few hundred people, all expiring within 24 hours. Almost all traffic flows from the server to many phones, and every phone wants to see its position change the moment it does.

## Decision

### 1. A single Go binary, standard library first

- `net/http` with Go 1.22+ `ServeMux` patterns serves both the JSON API and the static client, which is built into the binary with `embed`. There is no web framework and no router library.
- Logging is `log/slog`. Shutdown uses `signal.NotifyContext` and `http.Server.Shutdown`.
- The only third-party code is the embedded database ([ADR 0002](0002-embedded-database.md)).
- Builds are `CGO_ENABLED=0`: one static binary for each OS and architecture, and a `FROM scratch` image.

### 2. Live updates: server-sent events + `fetch`

- Browser → server: plain `fetch` calls to a JSON API.
- Server → browser: one `EventSource` per page. Each stream is personalised: a user's events carry their position, and the admin's carry the head of the queue.
- Why:
  - SSE is built into Go (`http.ResponseController.Flush`) and into every browser.
  - `EventSource` reconnects on its own, so we write no reconnect logic.
  - Updates flow one way (server → many), which is exactly what SSE is for.
- Rejected: WebSockets. They need a third-party library and hand-written reconnects, for traffic that is almost entirely one-way.

### 3. One replica

- State lives in an embedded database file ([ADR 0002](0002-embedded-database.md)), and change notifications are in-process.
- So the app runs as exactly one process: `replicas: 1`, `strategy: Recreate`, a small PVC.
- One Go process easily holds tens of thousands of SSE connections, far beyond the workload.

### 4. Security model

- **Admin access** is a capability:
  - creating a queue returns a random password (`crypto/rand`), stored only as a SHA-256 hash and compared in constant time;
  - the admin page URL carries it, and the API takes it as a bearer token;
  - `EventSource` can't set headers, so the admin's stream passes it as `?token=` (HTTPS only).
- **User ids** are tickets issued by the server in order (`A001` … `Z999`). They are easy to guess, so leaving the queue also needs a `key` returned on join: an HMAC of the id, keyed by the queue's password hash, so nothing more is stored.
- **Locations** are plain `lat,lon`, rounded to 4 decimals (about 11 m), so admins at the same spot share one queue.
- **Responses** send `Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (admin URLs contain the password).
- **Caps** of 1,000 people waiting per queue, 25,999 tickets per queue, 10,000 queues and 10,000-character messages bound memory and disk. An optional Traefik rate limit in the Helm chart throttles abusive clients.

### 5. Packaging

- An image for linux/amd64 and linux/arm64, cross-compiled, published to GHCR.
- A Helm chart published to GHCR as an OCI artifact; published chart versions are immutable.
- A `docker-compose.yml` for one-command local runs.
- CI runs:
  - `gofmt`, `go vet`, `go test -race` (on amd64 and arm64) and `govulncheck`;
  - Playwright browser tests against the real binary;
  - Helm chart validation, including the Traefik CRD.

## Consequences

Good:

- One process and one data file. `docker run` or `helm install` is the whole deployment.
- Very little code of our own; reconnects are the browser's job, and storage is the database's.
- Small, fast, and runs anywhere Go does.

Accepted trade-offs:

- **No horizontal scaling**, and a few seconds of downtime per deploy (`Recreate`). If it's ever needed, put a pub/sub such as NATS between replicas, or move to a networked database.
- **Six connections per host over HTTP/1.1**: browsers allow six connections per host, and each page holds one SSE connection. HTTP/2 behind any TLS proxy removes the limit.
- **Password in the URL**: the admin password appears in the admin URL and the SSE query string. Acceptable over HTTPS, and `Referrer-Policy: no-referrer` keeps it from leaking to other sites.
- **Node for tooling**: Node is still needed, but only as dev tooling for Playwright, Prettier and ESLint.
