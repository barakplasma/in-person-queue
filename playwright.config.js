const {defineConfig} = require('@playwright/test');

const PORT = process.env.PORT || '3000';

module.exports = defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ['geolocation'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'go run .',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // first run compiles
    env: {PORT, STATE_FILE: ''}, // memory only
  },
});
