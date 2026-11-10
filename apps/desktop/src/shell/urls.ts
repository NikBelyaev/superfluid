import { z } from 'zod';

export function httpUrl(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP or HTTPS URL without credentials.');
  return url.href;
}
export function externalUrl(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol === 't3code:' &&
    url.host === 'threads' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/[^/]+\/[^/]+$/.test(url.pathname) &&
    url.pathname
      .slice(1)
      .split('/')
      .every((part) => /^[a-zA-Z0-9:_-]{1,256}$/.test(decodeURIComponent(part)))
  )
    return url.href;
  if (
    url.protocol === 'codex:' &&
    url.host === 'threads' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    z.uuid().safeParse(url.pathname.slice(1)).success
  )
    return url.href;
  return httpUrl(raw);
}
