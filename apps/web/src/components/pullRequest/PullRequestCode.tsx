import { useEffect, useState } from 'react';
import type { PullRequestRef } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { Patch } from '~/components/diffs/Patch';
import { PullRequestCodeSkeleton } from './PullRequestSkeleton';

export function PullRequestCode({
  sessionId,
  repositoryId,
  request,
  commit,
}: {
  sessionId: string;
  repositoryId?: string;
  request: PullRequestRef;
  commit?: string;
}) {
  const { provider, host, project, number } = request;
  const [patch, setPatch] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [token, setToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void desktop
      .call('pr.patch', {
        sessionId,
        repositoryId,
        ref: { provider, host, project, number },
        commit,
      })
      .then((value) => {
        if (!cancelled) setPatch(value);
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, repositoryId, provider, host, project, number, commit, token]);
  if (error)
    return (
      <div className="surface-empty" role="alert">
        {error}
        <button className="button" onClick={() => setToken((value) => value + 1)}>
          Try again
        </button>
      </div>
    );
  if (patch === null) return <PullRequestCodeSkeleton />;
  return patch ? (
    <Patch patch={patch} fallback={<PullRequestCodeSkeleton />} />
  ) : (
    <div className="surface-empty">No diff available.</div>
  );
}
