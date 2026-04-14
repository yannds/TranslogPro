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
    port: 5173,
    // Proxy API → NestJS (évite CORS en dev)
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
