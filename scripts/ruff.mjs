import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { download } from './download.ts';

const version = '0.17.4';
const targets = {
  'darwin-arm64': [
    'aarch64-apple-darwin',
    '6ef8b3a7fd5294f5e8384ceb29784a6f5657da0853824312b1d2cef53aef17af',
  ],
  'darwin-x64': [
    'x86_64-apple-darwin',
    '0475a156ae8d73ba3386c90207804a72b3d7002ceb9dbca38dabc5d84aa95c9b',
  ],
  'linux-arm64': [
    'aarch64-unknown-linux-gnu',
    'b939676db4532f748dc38c41361a29260f18b3e24a787d46d9278e449c25c2cf',
  ],
  'linux-x64': [
    'x86_64-unknown-linux-gnu',
    '3ab2b34aeacdbc1ea5c529cdbda3e05792633d587228123fd09f3b5a0facb27a',
  ],
  'win32-arm64': [
    'aarch64-pc-windows-msvc',
    '44f5ca139d81e85fdc92c03ce759c30af834f6afaea22be449683b9e638e6b86',
  ],
  'win32-x64': [
    'x86_64-pc-windows-msvc',
    'd37f57c7a0cfb8ed5a39adc96f7a0a63767b3c5abe4629c4c84e33c06da46885',
  ],
};
const target = targets[`${process.platform}-${process.arch}`];
const executable = `ruff${process.platform === 'win32' ? '.exe' : ''}`;
const cache = fileURLToPath(new URL('../node_modules/.cache/superfluid/', import.meta.url));

export async function installRuff() {
  if (!target) throw new Error(`No bundled ruff for ${process.platform}-${process.arch}.`);
  const [triple, hash] = target;
  const archiveDirectory = process.platform === 'win32' ? '' : `ruff-${triple}`;
  const directory = join(cache, `ruff-${version}-${triple}`);
  const binary = join(directory, archiveDirectory, executable);
  try {
    await access(binary);
    return binary;
  } catch {}
  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(join(cache, 'ruff-download-'));
  try {
    const archive = `ruff-${triple}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
    const path = join(staging, archive);
    await download(
      `https://github.com/astral-sh/ruff/releases/download/${version}/${archive}`,
      path,
    );
    const data = await readFile(path);
    if (createHash('sha256').update(data).digest('hex') !== hash)
      throw new Error('Downloaded ruff failed SHA-256 verification.');
    execFileSync('tar', ['-xf', path, '-C', staging]);
    await rm(path);
    const stagedBinary = join(staging, archiveDirectory, executable);
    await chmod(stagedBinary, 0o755);
    assert.equal(
      execFileSync(stagedBinary, ['--version'], { encoding: 'utf8' }).trim().split(' ')[1],
      version,
    );
    await rename(staging, directory);
    return binary;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function copyRuff() {
  const binary = await installRuff();
  const destination = fileURLToPath(new URL(`../dist/${executable}`, import.meta.url));
  await mkdir(fileURLToPath(new URL('../dist/', import.meta.url)), { recursive: true });
  await copyFile(binary, destination);
  await chmod(destination, 0o755);
}
