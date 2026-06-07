import { defineConfig } from 'vitest/config'

// Backend coverage config, selected by the `coverage:server` script with --config.
// Kept separate from vite.config.js so the server run scopes coverage to server/**
// and emits its own lcov (coverage/server) without pulling in the frontend tree.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.js',
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
