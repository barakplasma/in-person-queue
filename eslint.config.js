const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'client/vendor/',
      'test-results/',
      'playwright-report/',
      'cloudflare/public/',
      'cloudflare/.wrangler/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {sourceType: 'commonjs', globals: globals.node},
  },
  {
    files: ['client/**/*.js', 'cloudflare/src/stream.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  {
    files: ['cloudflare/src/index.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.serviceworker,
        WebSocketPair: 'readonly',
        WebSocketRequestResponsePair: 'readonly',
      },
    },
  },
];
