import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Phase 1: the engine's demo page and the headless test harness.
export default defineConfig({
  root: 'engine',
  publicDir: 'public',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        demo: resolve(__dirname, 'engine/index.html'),
        harness: resolve(__dirname, 'engine/test/harness.html'),
      },
    },
  },
  server: { port: 5199 },
});
