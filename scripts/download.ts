import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

export async function download(url: string, destination: string) {
  const request = (url: string, accept?: string) =>
    fetch(url, {
      signal: AbortSignal.timeout(120000),
      headers: accept ? { Accept: accept } : undefined,
    });
  let response = await request(url);
  const release =
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/?]+)$/.exec(url);
  if (release && (response.status === 429 || response.status >= 500)) {
    await response.body?.cancel();
    console.error(
      `GitHub download returned HTTP ${response.status}; trying the release asset API…`,
    );
    const metadata = await request(
      `https://api.github.com/repos/${release[1]}/releases/tags/${release[2]}`,
      'application/vnd.github+json',
    );
    if (!metadata.ok)
      throw new Error(`Downloading release metadata failed: HTTP ${metadata.status}.`);
    const info = (await metadata.json()) as { assets: { name: string; url: string }[] };
    const asset = info.assets.find((asset) => asset.name === decodeURIComponent(release[3]));
    if (!asset) throw new Error(`Release asset not found: ${release[3]}.`);
    response = await request(asset.url, 'application/octet-stream');
  }
  if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status}.`);
  if (!response.body) throw new Error(`Empty download: ${url}.`);
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    createWriteStream(destination),
  );
}
