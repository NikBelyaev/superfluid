import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

export async function download(
  url: string,
  destination: string,
  options: { signal?: AbortSignal; maxBytes?: number; onProgress?: (percent: number) => void } = {},
) {
  const request = (url: string, accept?: string) => {
    const timeout = AbortSignal.timeout(120000);
    return fetch(url, {
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      headers: accept ? { Accept: accept } : undefined,
    });
  };
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
  const length = Number(response.headers.get('content-length'));
  const encoding = response.headers.get('content-encoding');
  const report =
    Number.isSafeInteger(length) && length > 0 && (!encoding || encoding === 'identity')
      ? options.onProgress
      : undefined;
  let percent = 0;
  report?.(percent);
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    async function* (source: AsyncIterable<Uint8Array>) {
      let bytes = 0;
      for await (const chunk of source) {
        bytes += chunk.byteLength;
        if (options.maxBytes !== undefined && bytes > options.maxBytes)
          throw new Error(`Download exceeds the allowed size: ${url}.`);
        if (report) {
          const next = Math.min(100, Math.floor((bytes / length) * 100));
          if (next !== percent) {
            percent = next;
            report(percent);
          }
        }
        yield chunk;
      }
    },
    createWriteStream(destination),
    { signal: options.signal },
  );
}
