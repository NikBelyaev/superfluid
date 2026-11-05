import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all([
  build({
    entryPoints: { main: 'apps/desktop/main.ts', preload: 'apps/desktop/preload.ts' },
    outdir: 'dist',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    target: 'node22',
    sourcemap: true,
  }),
  build({
    entryPoints: {
      backend: 'apps/server/index.ts',
      'terminal-worker': 'apps/server/terminal-worker.ts',
    },
    outdir: 'dist',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
    sourcemap: true,
  }),
  ...(process.argv.includes('--backend-only') ? [] : [viteBuild()]),
]);
await cp('packages/ghostty/vendor', 'dist/vendor', { recursive: true });
