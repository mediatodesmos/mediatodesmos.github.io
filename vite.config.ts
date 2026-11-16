import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
