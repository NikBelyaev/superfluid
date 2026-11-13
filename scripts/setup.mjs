import { spawnSync } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { installTy } from './ty.mjs';
import { installRuff } from './ruff.mjs';
import { copyZoekt } from './zoekt.mjs';
import { download } from './download.ts';
const require = createRequire(import.meta.url);
for (let attempt = 0; ; attempt++) {
  const install = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
    encoding: 'utf8',
    stdio: ['inherit', 'inherit', 'pipe'],
  });
  if (install.stderr) process.stderr.write(install.stderr);
  if (install.status === 0) break;
  if (attempt === 2 || !/HTTPError: Response code (?:429|5\d\d)\b/.test(install.stderr ?? ''))
    process.exit(install.status ?? 1);
  const artifact =
    /for (https:\/\/github\.com\/electron\/electron\/releases\/download\/[^/]+\/electron-[^\s]+-([a-z0-9]+)-([a-z0-9]+)\.zip)\b/.exec(
      install.stderr,
    );
  if (artifact) {
    const electronRequire = createRequire(require.resolve('electron/package.json'));
    const { downloadArtifact } = await import(electronRequire.resolve('@electron/get'));
    await downloadArtifact({
      version: require('electron/package.json').version,
      artifactName: 'electron',
      platform: artifact[2],
      arch: artifact[3],
      cacheRoot: process.env.electron_config_cache,
      checksums: require('electron/checksums.json'),
      downloader: { download },
    });
  }
  console.error('Retrying Electron download after a temporary HTTP failure…');
  await setTimeout(1000 * 2 ** attempt);
}
if (process.platform !== 'win32') {
  const base = dirname(require.resolve('node-pty/package.json'));
  await chmod(
    join(base, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    0o755,
  );
}
await installTy();
await installRuff();
await copyZoekt();
