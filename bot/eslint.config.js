const js = require('@eslint/js');
const globals = require('globals');

const nodeGlobals = { ...globals.node };
const browserGlobals = { ...globals.browser };

module.exports = [
  js.configs.recommended,
  {
    ignores: ['node_modules/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': 'off',
    },
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: { ...nodeGlobals, ...browserGlobals },
    },
  },
  {
    files: [
      'scripts/test-mock-done-page.js',
      'scripts/test-mock-job-page.js',
      'scripts/test-mock-profile-page.js',
      'scripts/test-mock-signup-page.js',
    ],
    languageOptions: {
      sourceType: 'module',
    },
  },
];
