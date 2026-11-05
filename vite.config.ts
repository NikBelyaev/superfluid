import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  logLevel: 'warn',
  root: 'apps/web',
  // The diff worker needs its package prepared before the first surface opens.
  optimizeDeps: { include: ['@pierre/diffs'] },
  base: './',
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: {
        order: 'post',
        handler: (html) =>
          html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''),
      },
    },
  ],
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'es2023' },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
});
