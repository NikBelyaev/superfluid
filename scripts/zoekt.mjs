import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const version = '1.27.3';
const targets = {
  'darwin-arm64': 'dd3908cf20959d798c1e06ebe5b72213f0505ce01373b40ce3110975a6cd99c2',
  'darwin-x64': 'b6f8e931e4ab497fcde6da8ae4499a58f9d258e55c8a80824a516eae5950a750',
  'linux-arm64': 'a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49',
  'linux-x64': '65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40',
  'win32-arm64': 'c507872ff21f8a7cd3c1c217b059c6f7271a4a9d8e692810ef9dd3e1f601197c',
  'win32-x64': 'f26081f438319757f8a1b46d7d0b2c5ec7583d4038e485e0aa725cfde7885fff',
};
const cache = fileURLToPath(new URL('../node_modules/.cache/superfluid/zoekt/', import.meta.url));
const source = fileURLToPath(new URL('../packages/zoekt/', import.meta.url));
const suffix = process.platform === 'win32' ? '.exe' : '';

export async function goToolchain() {
  const hash = targets[`${process.platform}-${process.arch}`];
  if (!hash) throw new Error(`No search toolchain for ${process.platform}-${process.arch}.`);
  const directory = join(cache, `go-${version}-${process.platform}-${process.arch}`);
  const binary = join(directory, 'go', 'bin', `go${suffix}`);
  try {
    await access(binary);
    return binary;
  } catch {}
  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(join(cache, 'go-download-'));
  try {
    const os = process.platform === 'win32' ? 'windows' : process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    const archive = `go${version}.${os}-${arch}.${suffix ? 'zip' : 'tar.gz'}`;
    console.log(`Downloading Go ${version} to build bundled code search…`);
    const response = await fetch(`https://go.dev/dl/${archive}`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(`Downloading search toolchain failed: HTTP ${response.status}.`);
    const data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== hash)
      throw new Error('Downloaded search toolchain failed SHA-256 verification.');
    const path = join(staging, archive);
    await writeFile(path, data);
    await exec('tar', ['-xf', path, '-C', staging]);
    await rm(path);
    await rename(staging, directory);
    return binary;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export const goEnvironment = () => ({
  ...process.env,
  CGO_ENABLED: '0',
  GOTOOLCHAIN: 'local',
  GOCACHE: join(cache, 'build'),
  GOMODCACHE: join(cache, 'modules'),
});

export async function copyZoekt() {
  const go = await goToolchain();
  const env = goEnvironment();
  const hash = createHash('sha256');
  for (const name of ['go.mod', 'go.sum', 'main.go', 'engine.go', 'files.go', 'scan.go'])
    hash.update(await readFile(join(source, name)));
  const directory = join(
    cache,
    `${process.platform}-${process.arch}-${hash.digest('hex').slice(0, 24)}`,
  );
  const binary = join(directory, `zoekt${suffix}`);
  try {
    await access(binary);
  } catch {
    await mkdir(directory, { recursive: true });
    console.log('Building bundled Zoekt search…');
    await exec(go, ['build', '-mod=readonly', '-trimpath', '-ldflags=-s -w', '-o', binary, '.'], {
      cwd: source,
      env,
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  await mkdir(dist, { recursive: true });
  await copyFile(binary, join(dist, `zoekt${suffix}`));
  await chmod(join(dist, `zoekt${suffix}`), 0o755);
  const { stdout } = await exec(go, ['list', '-m', '-json', 'all'], {
    cwd: source,
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
  const modules = [...stdout.matchAll(/\{[\s\S]*?\n\}/g)].map((match) => JSON.parse(match[0]));
  const notices = [await readFile(join(go, '../..', 'LICENSE'), 'utf8')];
  for (const module of modules) {
    if (!module.Dir || module.Main) continue;
    for (const entry of await readdir(module.Dir, { withFileTypes: true }))
      if (entry.isFile() && /^(?:LICENSE|COPYING|NOTICE)(?:[._-].*)?$/i.test(entry.name))
        notices.push(
          `${module.Path} — ${entry.name}\n${await readFile(join(module.Dir, entry.name), 'utf8')}`,
        );
  }
  await writeFile(join(dist, 'zoekt-licenses.txt'), notices.join('\n\n---\n\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--test') {
  const { stdout, stderr } = await exec(await goToolchain(), ['test', './...'], {
    cwd: source,
    env: goEnvironment(),
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
