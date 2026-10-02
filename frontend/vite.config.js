import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Runtime-cached API routes are intentionally limited to READ-ONLY,
// non-clinically-sensitive data a receptionist front desk needs to keep
// working from during a brief connectivity drop: today's queue and
// appointment schedule. Nothing here caches or replays POST/PUT/DELETE
// requests — Workbox only caches GET by default, and no write endpoint is
// listed below, so there is no path by which an offline mutation could be
// silently queued and later replayed against stale state. That is a
// deliberate safety choice (see README section 1, Phase 7c), not an
// oversight: blindly replaying a check-in or status change against
// out-of-date server state risks real scheduling conflicts.
const READ_ONLY_OFFLINE_ROUTES = [
  /\/api\/receptionist\/queue\/summary/,
  /\/api\/opd\/queue/,
  /\/api\/appointments\/receptionist\/appointments\/today/,
  /\/api\/appointments\/receptionist(\?.*)?$/,
]

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'ClinicConnect',
        short_name: 'ClinicConnect',
        description: 'Clinic & hospital management platform — patients, doctors, receptionists, and admins.',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built app shell (JS/CSS/HTML) so the SPA itself opens
        // offline instead of showing the browser's default offline error —
        // this is the "offline fallback" requirement for the app shell.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        runtimeCaching: READ_ONLY_OFFLINE_ROUTES.map((urlPattern) => ({
          urlPattern,
          method: 'GET',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'receptionist-offline-data',
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 12 },
            cacheableResponse: { statuses: [0, 200] },
          },
        })),
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
})
