/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'logo.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'RV BUSINESS HUB',
        short_name: 'RV Hub',
        description: 'Private business management for RV Camera Rent, Studio Of RV, Gift Park and The Frame House.',
        theme_color: '#14263D',
        background_color: '#F8FAFC',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the static app shell (JS/CSS/HTML/icons) is precached.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // PDF/Excel export code is fetched only when exporting; keep it out of the install.
        globIgnores: ['**/exporters-*.js'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Supabase API/auth traffic is never cached: financial and session
        // responses must always come from the network.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/rest/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (/node_modules[\\/](jspdf|jspdf-autotable|html2canvas|dompurify|canvg|write-excel-file|fflate|core-js|raf|rgbcolor|stackblur-canvas|svg-pathdata)[\\/]/.test(id)) return 'exporters'
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
