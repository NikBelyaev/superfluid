import { useEffect, useState } from 'react';
import type { SearchResults, SearchType } from '@superfluid/contracts';
import { searchWorktree } from '~/rpc/search';

export function useSearch(sessionId: string, query: string, types: SearchType[], scope?: string) {
  const [state, setState] = useState<{
    stamp: string;
    result?: SearchResults['search.query'];
    error?: string;
  }>();
  const stamp = JSON.stringify([query, types, scope]);
  useEffect(() => {
    const controller = new AbortController();
    if (!query.trim() || scope === '') return;
    const timer = setTimeout(() => {
      void (async () => {
        const { documents } = await import('~/state/editor/Documents');
        for (const doc of documents.items.values()) {
          if (doc.session.id !== sessionId || doc.readOnly || !doc.dirty) continue;
          controller.signal.throwIfAborted();
          await documents.recovery.flush(doc.key);
          if (
            (!types.length || types.some((type) => type === 'class' || type === 'symbol')) &&
            doc.model.getLanguageId() === 'python'
          )
            await documents.sync(doc);
        }
        return searchWorktree(
          sessionId,
          query,
          types,
          scope === undefined ? undefined : scope.split(','),
          controller.signal,
        );
      })()
        .then((value) => {
          if (!controller.signal.aborted) setState({ result: value, stamp });
        })
        .catch((error) => {
          if (!controller.signal.aborted) setState({ error: error.message, stamp });
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId, query, types, scope, stamp]);
  return {
    current: state?.stamp === stamp ? state.result : undefined,
    error: state?.stamp === stamp ? state.error : undefined,
    busy: !!query.trim() && scope !== '' && state?.stamp !== stamp,
    stamp,
  };
}
