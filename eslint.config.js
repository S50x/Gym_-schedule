/**
 * Flat config, deliberately narrow: rules that catch *mistakes*, nothing that
 * argues about formatting. The project has no Prettier and no house style to
 * enforce, so a stylistic ruleset here would only produce churn in git blame.
 *
 * The three environments are kept apart because this repo mixes them: the
 * server and the tests are Node, everything under public/js is a browser
 * module, and sw.js is a service worker.
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'coverage/**',
      'public/fonts/**',
      'docs/original-saadtraininglog.html',
    ],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // `next` is load-bearing in Express: an error handler is only recognised
      // as one if it declares four parameters, used or not.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$', caughtErrors: 'none' }],
    },
  },

  // ── Node: the server, the scripts, the unit tests ──────────────
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs', 'test/**/*.js'],
    languageOptions: { globals: globals.node },
  },

  // ── the browser bundle ─────────────────────────────────────────
  {
    files: ['public/js/**/*.js'],
    languageOptions: { globals: globals.browser },
  },

  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },

  // ── the browser journeys ───────────────────────────────────────
  // These are Node files, but the callbacks handed to page.evaluate() run in
  // the page. Without the browser globals, no-undef flags `localStorage` and
  // friends inside them.
  {
    files: ['test/browser/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
