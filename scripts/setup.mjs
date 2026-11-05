import { spawnSync } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const install = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
  stdio: 'inherit',
});
if (install.status !== 0) process.exit(install.status ?? 1);
if (process.platform !== 'win32') {
  const base = dirname(require.resolve('node-pty/package.json'));
  await chmod(
    join(base, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    0o755,
  );
}
