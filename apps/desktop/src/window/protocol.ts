import { protocol, net } from 'electron';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'superfluid',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function installAppProtocol(base: string) {
  protocol.handle('superfluid', (request) => {
    const url = new URL(request.url),
      file = resolve(base, '.' + decodeURIComponent(url.pathname));
    const rel = relative(base, file);
    if (url.host !== 'app' || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
}
