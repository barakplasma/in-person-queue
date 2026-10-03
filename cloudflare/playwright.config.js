// The same browser tests as the Go server (../e2e), against the Worker under `wrangler dev`.
// Run from the repo root: npx playwright test -c cloudflare/playwright.config.js
const base = require('../playwright.config.js');

module.exports = {
  ...base,
  testDir: '../e2e',
  use: {...base.use, baseURL: 'http://localhost:8787'},
  webServer: {
    command: 'npm run dev -- --port 8787',
    url: 'http://localhost:8787/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
};
