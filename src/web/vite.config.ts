/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://localhost:5080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in dev: the session cookie and OAuth callback go through the dev server.
    proxy: {
      '/api': api,
      '/auth': api,
      '/healthz': api,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // Worker threads start reliably here; forked processes regularly timed out starting on Windows.
    pool: 'threads',
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**'],
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
