// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist-web/**', 'node_modules/**'],
  },
  {
    files: ['app.config.js', 'babel.config.js', 'metro.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      // Monitoring/onboarding screens reset local form state when intervention/profile changes.
      'react-hooks/set-state-in-effect': 'off',
      'react/no-unescaped-entities': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]);
