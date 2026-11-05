import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Served from https://kareempalathingal.github.io/exportflow/
const BASE = '/exportflow/';

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        id: BASE,
        name: 'ExportFlow',
        short_name: 'ExportFlow',
        description: 'Personal manager assistant for export Job Orders',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#f6f5f1',
        theme_color: '#1f3a5f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${BASE}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // The PDF viewer's worker (pdf.js) is fetched the first time a PDF is viewed, then kept for offline use.
        // The Excel writer (exceljs) likewise: fetched on the first Excel file, then kept (5 Nov 2026).
        globIgnores: ['**/pdf-*.js', '**/xlsx-*.js'],
        runtimeCaching: [
          { urlPattern: /(\.mjs|\/pdf-[^/]+\.js)$/, handler: 'CacheFirst', options: { cacheName: 'exportflow-pdf-viewer', expiration: { maxEntries: 6 } } },
          { urlPattern: /\/xlsx-[^/]+\.js$/, handler: 'CacheFirst', options: { cacheName: 'exportflow-excel', expiration: { maxEntries: 3 } } },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'], xlsx: ['exceljs'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
