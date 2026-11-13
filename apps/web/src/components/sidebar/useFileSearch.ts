import { useCallback, useEffect, useState } from 'react';
import type { FileResults } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { searchFiles } from '~/rpc/fileSearch';

export function useFileSearch(sessionId: string) {
  const [value, setValue] = useState<string | null>(null);
  const query = value?.trim() ?? '';
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((revision) => revision + 1), []);
  const [state, setState] = useState<{
    stamp: string;
    query: string;
    result?: FileResults['files.search'];
    error?: string;
  }>();
  const change = useCallback(
    (value: string | null) => {
      setValue(value);
      if (!value?.trim()) setState(undefined);
      refresh();
    },
    [refresh],
  );
  const stamp = JSON.stringify([sessionId, query, revision]);
  useEffect(() => {
    if (!query) return;
    return desktop.onEvent((event) => {
      if (event.type === 'files.changed' && event.sessionId === sessionId) refresh();
    });
  }, [query, sessionId, refresh]);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    void searchFiles(sessionId, query, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setState({ stamp, query, result });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            stamp,
            query: previous?.query ?? '',
            result: previous?.result,
            error: error.message,
          }));
      });
    return () => {
      controller.abort();
    };
  }, [sessionId, query, stamp]);
  return {
    value,
    query,
    change,
    refresh,
    result: query ? state?.result : undefined,
    resultQuery: state?.query ?? '',
    error: state?.stamp === stamp ? state.error : undefined,
    busy: !!query && state?.stamp !== stamp,
  };
}
