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
import { goVersion, unpackGoToolchain } from './go-toolchain.ts';

const exec = promisify(execFile);
const cache = fileURLToPath(new URL('../node_modules/.cache/superfluid/zoekt/', import.meta.url));
const source = fileURLToPath(new URL('../packages/zoekt/', import.meta.url));
const suffix = process.platform === 'win32' ? '.exe' : '';

export async function goToolchain() {
  const directory = join(cache, `go-${goVersion}-${process.platform}-${process.arch}`);
  const binary = join(directory, 'go', 'bin', `go${suffix}`);
  try {
    await access(binary);
    return binary;
  } catch {}
  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(join(cache, 'go-download-'));
  try {
    console.log(`Downloading Go ${goVersion} to build bundled code search…`);
    await unpackGoToolchain(staging);
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
