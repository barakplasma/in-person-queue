const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {ignores: ['client/vendor/', 'test-results/', 'playwright-report/']},
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {sourceType: 'commonjs', globals: globals.node},
  },
  {
    files: ['client/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.browser,
    },
  },
];
