import { useEffect, useState } from 'react';
import type { HostingContext, Page, PullRequestSummary, Session } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { showSurface, useApp } from '~/state/workspaceStore';
import { RepositoryRemotePicker } from './RepositoryRemotePicker';

export function PullRequestList({
  session,
  repositoryId,
}: {
  session: Session;
  repositoryId?: string;
}) {
  const repositories = useApp((app) => app.repositories[session.id]);
  const repository = repositories?.find((r) => (repositoryId ? r.id === repositoryId : !r.path));
  const named =
    !!repository?.branch && !['Detached HEAD', 'Git unavailable'].includes(repository.branch);
  const [scope, setScope] = useState<'branch' | 'repository'>('branch');
  const effectiveScope = named ? scope : 'repository';
  const [state, setState] = useState<'open' | 'closed' | 'merged' | 'all'>('open');
  const [page, setPage] = useState(1);
  const [token, setToken] = useState(0);
  const [result, setResult] = useState<Page<PullRequestSummary> | null>(null);
  const [context, setContext] = useState<HostingContext | null>(null);
  const [needsRemote, setNeedsRemote] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setContext(null);
    setError('');
    setNeedsRemote(false);
    void desktop
      .call('pr.remotes', { sessionId: session.id, repositoryId })
      .then(async (remotes) => {
        if (cancelled) return;
        setNeedsRemote(!remotes.selected);
        if (!remotes.selected) return;
        const [context, result] = await Promise.all([
          desktop.call('pr.context', { sessionId: session.id, repositoryId }),
          desktop.call('pr.list', {
            sessionId: session.id,
            repositoryId,
            scope: effectiveScope,
            state,
            page,
          }),
        ]);
        if (!cancelled) {
          setContext(context);
          setResult(result);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, repositoryId, effectiveScope, repository?.branch, state, page, token]);
  const term = context
    ? context.provider === 'gitlab'
      ? 'Merge requests'
      : 'Pull requests'
    : 'Requests';
  return (
    <div className="surface-content pr-surface">
      <div className="pr-heading">
        <h2>{term}</h2>
        <p className="muted">
          {context ? `${context.host}/${context.targetProject}` : session.branch}
        </p>
        <RepositoryRemotePicker key={token} session={session} repositoryId={repositoryId} />
        <div className="pr-list-tools">
          {repositories && repositories.length > 1 && (
            <label>
              <span className="sr-only">Request repository</span>
              <select
                aria-label="Request repository"
                value={repository?.id || ''}
                onChange={(event) =>
                  showSurface({ kind: 'pr', repositoryId: event.target.value }, session.id)
                }
              >
                {repositories.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.path || 'Root'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="button" onClick={() => setToken((value) => value + 1)}>
            Refresh
          </button>
          <label className="sr-only" htmlFor="request-scope">
            Request scope
          </label>
          <select
            id="request-scope"
            value={effectiveScope}
            onChange={(e) => {
              setScope(e.target.value === 'branch' ? 'branch' : 'repository');
              setPage(1);
            }}
          >
            <option value="branch" disabled={!named}>
              Current branch
            </option>
            <option value="repository">Repository</option>
          </select>
          <label className="sr-only" htmlFor="request-state">
            Request state
          </label>
          <select
            id="request-state"
            value={state}
            onChange={(e) => {
              setState(e.target.value as typeof state);
              setPage(1);
            }}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="merged">Merged</option>
            <option value="all">All states</option>
          </select>
          <button
            className="button"
            disabled={!context}
            onClick={() =>
              useApp.setState({
                modal: { kind: 'git', action: 'pr', sessionId: session.id, repositoryId },
              })
            }
          >
            Create {context?.provider === 'gitlab' ? 'MR' : 'PR'}
          </button>
        </div>
      </div>
      <div className="pr-scroll">
        {needsRemote ? (
          <p>Choose a Git remote to load requests or publish this branch.</p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button className="button" onClick={() => setToken((value) => value + 1)}>
              Try again
            </button>{' '}
            <button
              className="button"
              onClick={() => useApp.setState({ modal: { kind: 'settings', section: 'hosting' } })}
            >
              Source Control accounts
            </button>
          </div>
        ) : !result ? (
          <p role="status">Loading requests…</p>
        ) : result.items.length === 0 ? (
          <p>No matching requests.</p>
        ) : (
          result.items.map((request) => (
            <button
              className="request-list-row"
              key={JSON.stringify(request.ref)}
              onClick={() =>
                showSurface({ kind: 'pr', repositoryId, ref: request.ref }, session.id)
              }
            >
              <span className="muted">
                {request.ref.provider === 'gitlab' ? '!' : '#'}
                {request.number} · {request.draft ? 'draft' : request.state}
              </span>
              <strong>{request.title}</strong>
              <small>
                {request.baseRefName} ← {request.headRefName}
              </small>
            </button>
          ))
        )}
        <div className="pr-list-tools">
          <button
            className="button"
            disabled={page === 1 || !result}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button className="button" disabled={!result?.hasMore} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
