import type { SearchType } from '@superfluid/contracts';
import { desktop } from './desktop';

export async function searchWorktree(
  sessionId: string,
  query: string,
  types: SearchType[],
  repositoryIds: string[] | undefined,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void desktop.call('search.cancel', { sessionId, requestId }).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await desktop.call('search.query', {
      sessionId,
      query,
      types,
      repositoryIds,
      requestId,
    });
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
