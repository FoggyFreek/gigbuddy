import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: [
      '@emotion/react',
      '@emotion/styled',
      '@mui/material',
      '@mui/system',
      '@mui/styled-engine',
    ],
  },
  optimizeDeps: {
    include: ['@emotion/react', '@emotion/styled'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: false,
        cookieDomainRewrite: 'localhost',
      },
    },
  },
  // `npm run preview` (and `build:all`) serve the production bundle; mirror the
  // dev proxy so /api still reaches the API on :3002.
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: false,
        cookieDomainRewrite: 'localhost',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.js',
    // Keep agent worktrees under .claude (full repo copies) out of test discovery.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    // Frontend coverage. The server suite uses vitest.server.config.js so each
    // run emits its own lcov (coverage/frontend, coverage/server), merged by Sonar.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage/frontend',
      include: ['src/**'],
      exclude: [
        'src/tests/**',
        'src/main.tsx',
        'public/**',
        '**/*.config.js',
      ],
    },
  },
})
