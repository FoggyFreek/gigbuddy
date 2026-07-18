import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server on :5174 proxying /api to the linkpage API on :3010, mirroring
// the gigbuddy dev setup. `npm run build` emits dist/, which server/index.js
// serves in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3010',
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
})
