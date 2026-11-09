import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { download } from '../scripts/download';
import { temp } from './fixtures';

const url = 'https://github.com/astral-sh/ty/releases/download/0.0.99/ty.tar.gz';
const metadata = 'https://api.github.com/repos/astral-sh/ty/releases/tags/0.0.99';
const asset = 'https://api.github.com/repos/astral-sh/ty/releases/assets/123';

for (const status of [200, 404, 429, 503, 504]) {
  test(`downloads release assets after HTTP ${status}`, async (t) => {
    const directory = await temp();
    try {
      const requests: { url: string; accept: string | null }[] = [];
      t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
        requests.push({ url: input, accept: new Headers(init?.headers).get('Accept') });
        if (input === url) return new Response('archive', { status });
        if (input === metadata)
          return Response.json({ assets: [{ name: 'ty.tar.gz', url: asset }] });
        assert.equal(input, asset);
        return new Response('archive');
      });
      const destination = join(directory, 'download');
      if (status === 404) {
        await assert.rejects(download(url, destination), /HTTP 404/);
        await assert.rejects(readFile(destination), { code: 'ENOENT' });
      } else {
        await download(url, destination);
        assert.equal(await readFile(destination, 'utf8'), 'archive');
      }
      assert.deepEqual(requests, [
        { url, accept: null },
        ...([429, 503, 504].includes(status)
          ? [
              { url: metadata, accept: 'application/vnd.github+json' },
              { url: asset, accept: 'application/octet-stream' },
            ]
          : []),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('release API errors fail the download without writing an artifact', async (t) => {
  const directory = await temp();
  try {
    t.mock.method(
      globalThis,
      'fetch',
      async (input: string) => new Response('unavailable', { status: input === url ? 504 : 403 }),
    );
    const destination = join(directory, 'download');
    await assert.rejects(download(url, destination), /release metadata failed: HTTP 403/);
    await assert.rejects(readFile(destination), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
