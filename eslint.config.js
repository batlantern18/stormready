// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo-export-check/**'],
  },
  {
    // The Jest setup file runs outside the app bundle and uses Jest globals.
    files: ['jest.setup.js'],
    languageOptions: {
      globals: { jest: 'readonly' },
    },
    rules: {
      'react/display-name': 'off',
    },
  },
]);
