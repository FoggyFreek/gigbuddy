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
        // Use rolldown's `codeSplitting.groups`, never the `manualChunks` function.
        // Under rolldown a named chunk also absorbs *unmatched* shared modules, so a
        // single stray helper in the entry graph turns the whole chunk into an eager
        // static import — that is how jsPDF, TipTap and the data grid used to land in
        // the initial load. Regexes match forward-slash ids (Vite normalizes them).
        //
        // Rule of thumb: every lazy-only library needs its own group, and any runtime
        // shared between an eager and a lazy consumer needs a *higher-priority* group
        // of its own, or the lazy consumer gets dragged along.
        codeSplitting: {
          groups: [
            // React core — almost everything depends on this; keep it small and stable
            {
              name: 'vendor-react',
              test: /node_modules\/(react|react-dom|scheduler|react-router|use-sync-external-store)\//,
              priority: 100,
            },
            // MUI icons ship thousands of SVG components; isolate so it only loads once
            { name: 'vendor-mui-icons', test: /node_modules\/@mui\/icons-material\//, priority: 95 },
            // MUI core + Emotion styling runtime
            {
              name: 'vendor-mui',
              test: /node_modules\/(@mui\/(material|system|utils|styled-engine|private-theming)|@emotion)\//,
              priority: 90,
            },
            // i18n runtime
            {
              name: 'vendor-i18n',
              test: /node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//,
              priority: 88,
            },
            // Shared MUI X runtime, used by BOTH the eager date pickers and the lazy
            // grid/charts. Without its own higher-priority group the ~390 kB data grid
            // rides into the initial load behind the pickers.
            {
              name: 'vendor-mui-x-core',
              test: /node_modules\/(@mui\/x-internals|@mui\/x-internal-gestures|@base-ui|@babel\/runtime|clsx|prop-types|react-transition-group|dom-helpers)\//,
              priority: 86,
            },
            // Date pickers are eager: main.tsx wraps the app in LocalizationProvider.
            { name: 'vendor-mui-pickers', test: /node_modules\/@mui\/x-date-pickers\//, priority: 80 },
            // The data grid is its own ~400 kB runtime and only the bank-import
            // review uses it — keep it out of the charts/pickers chunks.
            { name: 'vendor-mui-datagrid', test: /node_modules\/@mui\/x-data-grid\//, priority: 80 },
            // Charts pull in all of D3 and are only used by the financial dashboard.
            {
              name: 'vendor-charts',
              test: /node_modules\/(@mui\/x-charts|d3-|internmap|delaunator|robust-predicates|bezier-easing|flatqueue)/,
              priority: 80,
            },
            // Tiptap rich-text editor
            {
              name: 'vendor-editor',
              test: /node_modules\/(@tiptap|prosemirror-|orderedmap|w3c-keyname|rope-sequence|linkifyjs)/,
              priority: 80,
            },
            // PDF viewer runtime (pdfjs-dist alone is ~800 kB minified)
            { name: 'vendor-pdfjs', test: /node_modules\/(react-pdf|pdfjs-dist)\//, priority: 80 },
            // Client-side PDF/image generation (separate from the viewer)
            {
              name: 'vendor-pdf-gen',
              test: /node_modules\/(jspdf|html-to-image|fast-png|iobuffer|pako|fflate)\//,
              priority: 80,
            },
            // ABC music notation renderer (large standalone library)
            { name: 'vendor-abcjs', test: /node_modules\/abcjs\//, priority: 80 },
            // ChordPro parser
            { name: 'vendor-chordpro', test: /node_modules\/chordsheetjs\//, priority: 80 },
            // Map libraries
            { name: 'vendor-maps', test: /node_modules\/(leaflet|react-leaflet|@react-leaflet)\//, priority: 80 },
            // Drag-and-drop
            { name: 'vendor-dnd', test: /node_modules\/@dnd-kit\//, priority: 80 },
            // File-processing utilities (Excel, CSV, image compression)
            {
              name: 'vendor-files',
              test: /node_modules\/(exceljs|papaparse|browser-image-compression)\//,
              priority: 80,
            },
            // No catch-all `/node_modules/` group on purpose: anything unmatched must
            // stay in rolldown's automatic per-dynamic-import chunks so it loads with
            // the lazy route that needs it.
          ],
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
    // The heaviest component tests (gig detail, member dialogs) run ~3 s on a
    // fast dev box and 2-3x that on a CI runner under v8 coverage. The 5 s
    // default left no margin, so keep failures meaningful rather than timing.
    testTimeout: 20000,
    hookTimeout: 20000,
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
        '**/__tests__/**',
        'src/tests/**',
        'src/main.tsx',
        'public/**',
        '**/*.config.js',
      ],
    },
  },
})
