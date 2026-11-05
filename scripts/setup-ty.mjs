import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '0.0.98';
const targets = {
  arm64: ['aarch64', 'f442260e735f8edc2e8df47afde4513ca1ba00afe1d519498545abf5f71cbefa'],
  x64: ['x86_64', 'b717dd57d4ef2f332bad8f1d39c7cf876e5e82886f3935ccca95ce523b31f9ee'],
};
const target = targets[process.arch];
if (process.platform !== 'darwin' || !target)
  throw new Error('Superfluid currently bundles ty for macOS arm64 and x64 only.');
const directory = fileURLToPath(new URL('../packages/ty/vendor/', import.meta.url));
const binary = join(directory, `ty-${process.platform}-${process.arch}`);
const installed = spawnSync(binary, ['--version'], { encoding: 'utf8' });
if (installed.status !== 0 || installed.stdout?.split(' ')[1] !== version) {
  const name = `ty-${target[0]}-apple-darwin`;
  const response = await fetch(
    `https://github.com/astral-sh/ty/releases/download/${version}/${name}.tar.gz`,
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok) throw new Error(`Downloading ty failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== target[1])
    throw new Error('Downloaded ty archive failed SHA-256 verification.');
  const temporary = await mkdtemp(join(tmpdir(), 'superfluid-ty-'));
  try {
    const path = join(temporary, 'ty.tar.gz');
    await writeFile(path, archive);
    const result = spawnSync('tar', ['-xzf', path, '-C', temporary], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Extracting ty failed.');
    await mkdir(directory, { recursive: true });
    const extracted = join(temporary, name, 'ty');
    await chmod(extracted, 0o755);
    const check = spawnSync(extracted, ['--version'], { encoding: 'utf8' });
    if (check.status !== 0 || check.stdout.split(' ')[1] !== version)
      throw new Error('Downloaded ty executable failed its version check.');
    await copyFile(extracted, binary);
    console.log(`Installed ty ${version} (${process.arch}).`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
