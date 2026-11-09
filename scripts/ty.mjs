import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { download } from './download.ts';

const version = '0.0.99';
const targets = {
  'darwin-arm64': [
    'aarch64-apple-darwin',
    '9967b1433cc65f2c89c74794bca7a767bcb45f400ff0d61102b93486657bb1d4',
  ],
  'darwin-x64': [
    'x86_64-apple-darwin',
    '55690b8bb224f186e84bd3ea32eb9855a2408a7866ca3ed439ebc56b89bcc82f',
  ],
  'linux-arm64': [
    'aarch64-unknown-linux-gnu',
    '8db8b7a5a5875ca593b0f92561f5f2285056a782737c33a187d1ffd3f5f0d716',
  ],
  'linux-x64': [
    'x86_64-unknown-linux-gnu',
    'b98eec859fa0a840dcfff013f208b7a9d71051bf3f693dff68a9bedb0e19c449',
  ],
  'win32-arm64': [
    'aarch64-pc-windows-msvc',
    '85b1057a142c5e0ac3b6fe997fd6deba7986dbe8504d58b4671d6cae11e08033',
  ],
  'win32-x64': [
    'x86_64-pc-windows-msvc',
    'b6ee52f5921ba8c911e8b4dc28b0860c12aae96774c1e33369d2ee3bdb4df76a',
  ],
};
const target = targets[`${process.platform}-${process.arch}`];
const executable = `ty${process.platform === 'win32' ? '.exe' : ''}`;
const cache = fileURLToPath(new URL('../node_modules/.cache/superfluid/', import.meta.url));

export async function installTy() {
  if (!target) throw new Error(`No bundled ty for ${process.platform}-${process.arch}.`);
  const [triple, hash] = target;
  const directory = join(cache, `ty-${version}-${triple}`);
  const binary = join(directory, `ty-${triple}`, executable);
  try {
    await access(binary);
    return binary;
  } catch {}
  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(join(cache, 'ty-download-'));
  try {
    const archive = `ty-${triple}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
    const path = join(staging, archive);
    await download(`https://github.com/astral-sh/ty/releases/download/${version}/${archive}`, path);
    const data = await readFile(path);
    if (createHash('sha256').update(data).digest('hex') !== hash)
      throw new Error('Downloaded ty failed SHA-256 verification.');
    execFileSync('tar', ['-xf', path, '-C', staging]);
    await rm(path);
    const stagedBinary = join(staging, `ty-${triple}`, executable);
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

export async function copyTy() {
  const binary = await installTy();
  const destination = fileURLToPath(new URL(`../dist/${executable}`, import.meta.url));
  await mkdir(fileURLToPath(new URL('../dist/', import.meta.url)), { recursive: true });
  await copyFile(binary, destination);
  await chmod(destination, 0o755);
}
