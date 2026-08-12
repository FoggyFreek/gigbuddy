import { defineConfig } from 'vitest/config'

// The backend suite's config. Two things make it distinct from vite.config.js:
//
// 1. Parallelism. globalSetup builds a schema-only template database and each
//    worker clones it (src/tests/server/_workerDatabase.js), so test files no
//    longer share one database and --no-file-parallelism is unnecessary.
// 2. Coverage scoped to server/**, emitting its own lcov (coverage/server).
//
// maxWorkers is capped because every worker holds a pg pool against a server
// with max_connections=100; PG_POOL_MAX (set in _envSetup.js) caps the other side.
const maxWorkers = Number.parseInt(process.env.GIGBUDDY_TEST_MAX_WORKERS ?? '', 10) || 8

export default defineConfig({
  test: {
    // No server test touches the DOM, so skip jsdom and src/tests/setup.js
    // (jest-dom + React Testing Library + i18n) — pure per-file overhead here.
    environment: 'node',
    globals: true,
    globalSetup: './src/tests/server/_globalSetup.js',
    setupFiles: ['./src/tests/server/_workerDatabase.js'],
    testTimeout: 20000,
    hookTimeout: 30000,
    pool: 'forks',
    maxWorkers,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage/server',
      include: ['server/**'],
      exclude: [
        'server/db/migrations/**',
        '**/*.config.js',
      ],
    },
  },
})
