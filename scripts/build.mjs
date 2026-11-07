import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, cp, rm } from 'node:fs/promises';
import { copyTy } from './ty.mjs';
await mkdir('dist', { recursive: true });
await copyTy();
await Promise.all([
  build({
    entryPoints: { main: 'apps/desktop/src/main.ts', preload: 'apps/desktop/src/preload.ts' },
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
      backend: 'apps/server/src/main.ts',
      'terminal-worker': 'apps/server/src/terminal/terminal-worker.ts',
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
await rm('dist/vendor', { recursive: true, force: true });
await cp('packages/ghostty/vendor', 'dist/vendor', { recursive: true });
