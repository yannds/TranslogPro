import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType:    'autoUpdate',
      injectRegister:  'auto',
      workbox: {
        // Fichiers statiques mis en pre-cache. On évite les gros assets bin.
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,jpg,webp}'],
        // PageTemplateStudio est lazy-loadé et pèse actuellement 12.7 MB à
        // cause de ses dépendances PDF/images — on l'exclut du précache
        // plutôt que de gonfler le SW. L'utilisateur téléchargera ce chunk
        // à la demande (route rarement visitée).
        globIgnores: ['**/PageTemplateStudio-*.js'],
        // Navigations → fallback index.html (SPA).
        navigateFallback: '/index.html',
        // Bump du seuil de précache : le main bundle dépasse 2 MiB (défaut)
        // depuis l'ajout du parcours public (landing + signup + onboarding +
        // billing). 5 MiB laisse une marge — à ramener < 2 MiB au prochain
        // passage en lazy-loading (split des routes publiques).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Runtime caching : les GET /api/... sont en Network-First avec
        // fallback cache, pour que l'UI reste navigable hors ligne.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'translog-api-cache',
              networkTimeoutSeconds: 6,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 24 * 3600, // 24h — latence max pour des données "obsolètes mais lisibles"
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Fonts Google + @fontsource → StaleWhileRevalidate
            urlPattern: /\.(?:woff2?|eot|ttf|otf)$/,
            handler:    'StaleWhileRevalidate',
            options:    { cacheName: 'translog-fonts' },
          },
        ],
      },
      manifest: {
        name:             'TransLog Pro',
        short_name:       'TransLog',
        description:      'Plateforme SaaS transport et logistique.',
        theme_color:      '#0f766e',
        background_color: '#ffffff',
        display:          'standalone',
        start_url:        '/',
        scope:            '/',
        orientation:      'any',
        lang:             'fr',
        categories:       ['business', 'productivity', 'travel'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // En dev : service worker actif pour pouvoir tester offline.
      devOptions: { enabled: false },
    }),
  ],

  resolve: {
    alias: {
      '@ui':     path.resolve(__dirname, './components/ui'),
      '@form':   path.resolve(__dirname, './components/form'),
      '@layout': path.resolve(__dirname, './components/layout'),
      '@lib':    path.resolve(__dirname, './lib'),
    },
  },

  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.translog.test', 'localhost', '127.0.0.1'],
    hmr: true,
    proxy: {
      '/api': {
        target:       'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('X-Forwarded-For', '127.0.0.1');
          });
        },
      },
    },
  },

  build: {
    outDir:    '../dist/frontend',
    emptyOutDir: true,
  },
});
