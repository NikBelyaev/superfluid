import { desktop } from './desktop';

export async function searchFiles(sessionId: string, query: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void desktop.call('files.cancel', { sessionId, requestId }).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await desktop.call('files.search', { sessionId, query, requestId });
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
