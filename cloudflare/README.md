# in-person-queue on Cloudflare (free plan) or celld

The same app as the Go server, with the same web client and the same JSON API, as a Cloudflare Workers project. It runs:

- on **Cloudflare's free plan**, so you can host it yourself with no server of your own;
- on **[celld](https://github.com/denoland/celld)**, Deno's open-source runtime for Workers apps, if you'd rather self-host it later. You keep the same code and move it off Cloudflare.

The browser tests in [`../e2e`](../e2e) pass against all three: the Go server, `wrangler dev` and `celld dev`. See [ADR 0004](../docs/adr/0004-cloudflare-prototype.md) for the design and its trade-offs.

## Deploy your own (about 2 minutes, free)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/barakplasma/in-person-queue/tree/main/cloudflare)

1. Click the button and sign in to Cloudflare. A free account is enough.
2. Connect GitHub (or GitLab). Cloudflare copies this folder into a new repository on your account and deploys it.
3. Open `https://in-person-queue.<your-subdomain>.workers.dev`. Every push to your copy redeploys it.

Or, from a clone:

```sh
cd cloudflare
npm ci
npx wrangler login
npm run deploy
```

## Develop

```sh
cd cloudflare && npm ci
npm run dev      # wrangler dev on http://localhost:8787
npm run celld    # or celld dev on http://localhost:9876 (needs celld: curl -fsSL https://celld.dev/install.sh | sh)
npx playwright test -c cloudflare/playwright.config.js   # from the repo root: the shared browser tests
```

- `public/` is a copy of [`../client`](../client), plus `stream.js` (WebSockets instead of server-sent events) and `_headers` (security headers).
- The Deploy button only copies this folder, so the copy is committed. Run `npm run assets` after changing `../client`; CI checks the copy is up to date.

## How it maps

| Go server                              | Here                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| one process, one SQLite file via Redka | one **Durable Object per queue**, each with its own SQLite database, plus one `Directory` object for "nearby" |
| server-sent events                     | **hibernating WebSockets**: an idle queue costs nothing while phones stay connected                           |
| a sweep every 10 s closes queues       | a Durable Object **alarm** at each queue's closing time                                                       |
| embedded web client                    | Workers static assets (free, not counted as requests)                                                         |

## Free plan budget

- **Workers and Durable Objects**: each has 100,000 requests a day, and Durable Objects also get 13,000 GB-s of compute a day.
- **Static files** (the pages, scripts and CSS) are free.
- **Per person waiting**: about 3 requests to join, plus about 6 an hour while they wait. A phone sends a ping every 30 s, and incoming WebSocket messages are billed at 20:1.
- **Capacity**: that's roughly **10,000 person-hours of waiting a day**. An idle queue hibernates, so it uses no compute.
- **Over the limit**: requests fail until the daily reset at 00:00 UTC. Nothing is billed on the free plan.
