import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { download } from './download.ts';

export const goVersion = '1.27.3';
const checksums: Record<string, string> = {
  'darwin-arm64': 'dd3908cf20959d798c1e06ebe5b72213f0505ce01373b40ce3110975a6cd99c2',
  'darwin-x64': 'b6f8e931e4ab497fcde6da8ae4499a58f9d258e55c8a80824a516eae5950a750',
  'linux-arm64': 'a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49',
  'linux-x64': '65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40',
  'win32-arm64': 'c507872ff21f8a7cd3c1c217b059c6f7271a4a9d8e692810ef9dd3e1f601197c',
  'win32-x64': 'f26081f438319757f8a1b46d7d0b2c5ec7583d4038e485e0aa725cfde7885fff',
};
const exec = promisify(execFile);

export async function unpackGoToolchain(
  staging: string,
  options: {
    signal?: AbortSignal;
    onDownload?: (percent: number) => void;
    onUnpack?: () => void;
  } = {},
) {
  const { signal, onDownload, onUnpack } = options;
  const target = `${process.platform}-${process.arch}`;
  const checksum = checksums[target];
  if (!checksum) throw new Error(`Go toolchain installation is unavailable for ${target}.`);

  const windows = process.platform === 'win32';
  const os = windows ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const archive = `go${goVersion}.${os}-${arch}.${windows ? 'zip' : 'tar.gz'}`;
  const path = join(staging, archive);
  await download(`https://go.dev/dl/${archive}`, path, {
    signal,
    maxBytes: 96 * 1024 * 1024,
    onProgress: onDownload,
  });

  onUnpack?.();
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  if (hash.digest('hex') !== checksum) throw new Error('Go download failed SHA-256 verification.');

  await exec('tar', ['-xf', path], { cwd: staging, signal, timeout: 60000 });
  await rm(path);
}
