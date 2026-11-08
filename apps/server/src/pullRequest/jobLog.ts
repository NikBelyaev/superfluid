import { stripVTControlCharacters } from 'node:util';

export function formatJobLog(raw: string, truncated = false) {
  const text = stripVTControlCharacters(raw)
    .replace(/^section_(?:start|end):\d+:[^\r\n]*\r?/gm, '')
    .replace(/\r\n?/g, '\n');
  const limit = 256 * 1024;
  const bytes = Buffer.from(text);
  let start = Math.max(0, bytes.length - limit);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return { text: bytes.subarray(start).toString('utf8'), truncated: truncated || start > 0 };
}
