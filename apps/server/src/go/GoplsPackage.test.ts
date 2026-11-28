import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, readdir, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { temp } from '../../../../tests/fixtures';
import { unpackGoToolchain } from '../../../../scripts/go-toolchain.ts';
import { GoplsPackage } from './GoplsPackage';
import { goName, goplsName, managedGopls } from './goExecutables';

test('Go toolchain downloads are verified before extraction', async (t) => {
  const staging = await temp();
  const archive = 'invalid archive';
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(archive, {
        headers: { 'content-length': String(Buffer.byteLength(archive)) },
      }),
  );
  const progress: (number | 'unpacking')[] = [];
  await assert.rejects(
    unpackGoToolchain(staging, {
      onDownload: (percent) => progress.push(percent),
      onUnpack: () => progress.push('unpacking'),
    }),
    /SHA-256 verification/,
  );
  assert.deepEqual(progress, [0, 100, 'unpacking']);
  await assert.rejects(access(join(staging, 'go')), { code: 'ENOENT' });
});

test('gopls install publishes the staged binary only on success and removal keeps external tools', async () => {
  const directory = await temp();
  const bin = await temp();
  const external = join(bin, goplsName);
  const managed = managedGopls(directory);
  const installer = createServer();
  await new Promise<void>((resolve) => installer.listen(0, '127.0.0.1', resolve));
  const address = installer.address();
  assert.ok(address && typeof address !== 'string');
  const previous = { path: process.env.PATH, gopls: process.env.SF_GOPLS_PATH };
  let socket: Socket | undefined;
  let stopped = 0;
  const packageManager = new GoplsPackage(
    directory,
    () => {},
    () => stopped++,
  );
  try {
    await writeFile(
      join(bin, goName),
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.cwd() !== fs.realpathSync(process.env.GOBIN) || process.argv[2] !== 'install') process.exit(2);
fs.writeFileSync(path.join(process.env.GOBIN, ${JSON.stringify(goplsName)}), '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });
const socket = require('node:net').connect(${address.port}, '127.0.0.1');
socket.on('data', (data) => {
  if (data.toString() === 'fail') {
    console.error('Download failed');
    process.exitCode = 1;
  }
});
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}${delimiter}${previous.path ?? ''}`;
    process.env.SF_GOPLS_PATH = external;

    const startInstall = async () => {
      const connected = once(installer, 'connection');
      packageManager.install();
      const [socket] = await Promise.race([
        connected,
        packageManager.close().then(async () => {
          throw new Error(`Installer never connected: ${(await packageManager.status()).error}`);
        }),
      ]);
      return socket as Socket;
    };

    socket = await startInstall();
    const status = await packageManager.status();
    assert.equal(status.operation, 'installing');
    assert.deepEqual(status.progress, { stage: 'installing-gopls' });
    await assert.rejects(access(managed), { code: 'ENOENT' });
    socket.end('fail');
    await packageManager.close();
    assert.equal((await packageManager.status()).error, 'Download failed');
    assert.deepEqual(await readdir(dirname(managed)), []);

    socket = await startInstall();
    packageManager.install();
    assert.throws(() => packageManager.remove(), /operation to finish/);
    socket.end('success');
    await packageManager.close();
    assert.deepEqual(await packageManager.status(), {
      source: 'managed',
      goAvailable: true,
      operation: null,
      error: undefined,
    });
    assert.equal(stopped, 1);
    assert.deepEqual(await readdir(dirname(managed)), [goplsName]);

    await writeFile(external, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    packageManager.remove();
    await packageManager.close();
    assert.equal((await packageManager.status()).source, 'external');
    assert.equal(stopped, 2);
    await access(external);
    await assert.rejects(access(managed), { code: 'ENOENT' });
  } finally {
    socket?.destroy();
    installer.close();
    await packageManager.close();
    if (previous.path === undefined) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.gopls === undefined) delete process.env.SF_GOPLS_PATH;
    else process.env.SF_GOPLS_PATH = previous.gopls;
  }
});
