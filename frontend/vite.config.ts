import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@ui':     path.resolve(__dirname, './components/ui'),
      '@form':   path.resolve(__dirname, './components/form'),
      '@layout': path.resolve(__dirname, './components/layout'),
      '@lib':    path.resolve(__dirname, './lib'),
    },
  },

  server: {
    // 0.0.0.0 — indispensable pour que Caddy (dans un container Docker)
    // puisse atteindre Vite via host.docker.internal. Sans ça Vite n'écoute
    // que sur localhost IPv6, et Caddy reçoit "Connection refused" sur la
    // route catch-all `handle { reverse_proxy host.docker.internal:5173 }`.
    host: '0.0.0.0',
    port: 5173,
    // Vite rejette par défaut les requêtes dont le Host header ne correspond
    // pas à `server.host`. En dev multi-tenant le browser envoie
    // `tenanta.translog.test` comme Host → on doit explicitement autoriser
    // tout *.translog.test + localhost/127.0.0.1 pour ne pas bloquer Caddy.
    allowedHosts: ['.translog.test', 'localhost', '127.0.0.1'],

    // HMR : le browser charge la page via Caddy (HTTPS :443), donc la socket
    // HMR doit aussi passer par Caddy en wss. Sans ça Vite tente `ws://host/`
    // puis fallback `wss://localhost:5173` qui échoue (Vite ne sert pas TLS).
    hmr: {
      protocol:   'wss',
      clientPort: 443,   // port côté browser — Caddy proxifie vers :5173
    },

    // Proxy API → NestJS (évite CORS en dev quand on hit Vite directement
    // sur localhost:5173 sans passer par Caddy).
    proxy: {
      '/api': {
        target:      'http://localhost:3000',
        changeOrigin: true,
        // Sessions cookies transmis
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
