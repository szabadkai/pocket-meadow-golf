import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    testTimeout: 120000,
  },
} as never);
