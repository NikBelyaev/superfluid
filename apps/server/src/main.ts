import { Workspace } from './workspace/Workspace';
import type { Method } from '@superfluid/contracts';
import { stopCommands } from './process/ProcessRunner';

const port = (process as any).parentPort;

if (!port) throw new Error('The workspace backend must be started by Electron.');

const workspace = new Workspace(process.argv[2], (event) => port.postMessage({ event }));

let closing = false;

const active = new Set<Promise<unknown>>();

port.on('message', async ({ data }: any) => {
  const { id, method, input } = data;
  try {
    if (method === 'shutdown') {
      if (!closing) {
        closing = true;
        workspace.lsp.close();
        await stopCommands();
        await Promise.allSettled([...active]);
        await workspace.close();
      }
      port.postMessage({ id, result: null });
      return;
    }
    if (closing) throw new Error('Superfluid is closing.');
    const task = workspace.call(method as Method, input);
    active.add(task);
    try {
      const result = await task;
      port.postMessage({ id, result });
    } finally {
      active.delete(task);
    }
  } catch (e: any) {
    port.postMessage({ id, error: e.message || 'Workspace operation failed.' });
  }
});

port.postMessage({ ready: true });
