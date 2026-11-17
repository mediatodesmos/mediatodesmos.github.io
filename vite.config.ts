import { defineConfig, type Plugin } from 'vitest/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Dev-only: lets tools/showcase.html save traced showcase renders into
 * public/showcase/. Only names like "waguri-outline.svg" are accepted, so the
 * endpoint cannot write anywhere else. Never part of the production build.
 */
function saveShowcase(): Plugin {
  return {
    name: 'm2d-save-showcase',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-showcase', (req, res) => {
        const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '';
        if (req.method !== 'POST' || !/^[a-z0-9-]+\.(svg|json)$/.test(name)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = resolve(__dirname, 'public/showcase');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), Buffer.concat(chunks));
          res.end('saved');
        });
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [saveShowcase()],
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
