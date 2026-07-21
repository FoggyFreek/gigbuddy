import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // abcjs and pdfjs-dist are irreducibly large single-library chunks; 800 kB is
    // a more honest limit than 500 kB for an app that ships a music engraver and PDF viewer.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // React core — almost everything depends on this; keep it small and stable
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('react-router')) {
            return 'vendor-react'
          }
          // MUI icons ship thousands of SVG components; isolate so it only loads once
          if (id.includes('@mui/icons-material')) return 'vendor-mui-icons'
          // MUI X packages pull in D3 / heavier chart/picker logic
          if (id.includes('@mui/x-')) return 'vendor-mui-x'
          // MUI core + Emotion styling runtime
          if (id.includes('@mui/') || id.includes('@emotion/')) return 'vendor-mui'
          // Tiptap rich-text editor
          if (id.includes('@tiptap/') || id.includes('prosemirror')) return 'vendor-editor'
          // ABC music notation renderer (large standalone library)
          if (id.includes('abcjs')) return 'vendor-abcjs'
          // ChordPro parser
          if (id.includes('chordsheetjs')) return 'vendor-chordpro'
          // Map libraries
          if (id.includes('leaflet') || id.includes('react-leaflet')) return 'vendor-maps'
          // PDF viewer runtime (pdfjs-dist alone is ~800 kB minified)
          if (id.includes('react-pdf') || id.includes('pdfjs-dist')) return 'vendor-pdfjs'
          // Client-side PDF/image generation (separate from the viewer)
          if (id.includes('jspdf') || id.includes('html-to-image')) return 'vendor-pdf-gen'
          // File-processing utilities (Excel, CSV, image compression)
          if (
            id.includes('exceljs') ||
            id.includes('papaparse') ||
            id.includes('browser-image-compression')
          ) return 'vendor-files'
          // i18n runtime
          if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n'
          // Drag-and-drop
          if (id.includes('@dnd-kit/')) return 'vendor-dnd'
        },
      },
    },
  },
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
