import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import electron from 'electron';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: { main: 'apps/desktop/src/main.ts', preload: 'apps/desktop/src/preload.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
await build({
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
});
await rm('dist/vendor', { recursive: true, force: true });
await cp('packages/ghostty/vendor', 'dist/vendor', { recursive: true });
const server = await createServer();
await server.listen();
const env = { ...process.env, SF_DEV_URL: 'http://127.0.0.1:5176' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
const stop = async () => {
  child.kill();
  await server.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', async (code) => {
  await server.close();
  process.exitCode = code ?? 0;
});
