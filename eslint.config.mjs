import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '.runtime/**',
      '.state/**',
      '.tmp/**',
      '.venv/**',
      '**/node_modules/**',
      '**/__pycache__/**',
      'web/vendor/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { ecmaVersion: 'latest', globals: globals.node },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-constant-binary-expression': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: [
      'web/**/*.js',
      'prototypes/**/*.js',
      'activity/extension/**/*.js',
      'desktop/electron/overlay.js',
    ],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['activity/extension/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        chrome: 'readonly',
        EiloActivityExtensionCore: 'readonly',
        importScripts: 'readonly',
      },
    },
  },
  {
    files: ['web/speech/mic-worklet.js'],
    languageOptions: {
      globals: { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly' },
    },
  },
  {
    files: ['desktop/electron/preload.cjs'],
    languageOptions: { globals: { location: 'readonly' } },
  },
];
