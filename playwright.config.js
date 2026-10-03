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
    command: 'node server.js',
    url: `http://localhost:${PORT}/healthcheck`,
    reuseExistingServer: !process.env.CI,
    env: {PORT},
  },
});
