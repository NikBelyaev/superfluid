import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, GitPullRequest, GitPullRequestDraft } from 'lucide-react';
import { repositoryConnection, type PullRequestSummary, type Session } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { showSurface, useApp } from '~/state/workspaceStore';
import { selectedRepositories } from '~/state/repositories';
import { RequestCI } from './RequestCI';
import {
  emptyBranchRequests,
  updateBranchRequests,
  useBranchRequests,
  type BranchRequestResult,
} from './branchRequests';

export function IslandRequests({ session }: { session: Session }) {
  const discovered = useApp((app) => app.repositories[session.id]);
  const repositoryIds = useApp((app) => app.views[session.id]?.repositoryIds);
  const repositories = selectedRepositories(discovered ?? [], repositoryIds);
  const project = useApp((app) => app.projects.find((p) => p.id === session.projectId));
  const signature = JSON.stringify(
    Object.fromEntries(
      repositories.map((r) => [
        r.id,
        JSON.stringify([session.id, r.branch, repositoryConnection(project, r.path)]),
      ]),
    ),
  );
  const identities: Record<string, string> = useMemo(() => JSON.parse(signature), [signature]);
  const [token, setToken] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const results = useBranchRequests((state) => state.sessions[session.id] ?? emptyBranchRequests);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let initial = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (cancelled || running || document.hidden || !Object.keys(identities).length) return;
      running = true;
      setLoading(true);
      clearTimeout(timer);
      try {
        if (!initial) await useApp.getState().refreshRepositories(session.id, true);
        initial = false;
        if (cancelled) return;
        const pending = (useApp.getState().repositories[session.id] || [])
          .filter(
            (r) =>
              identities[r.id] &&
              r.branch &&
              !['Detached HEAD', 'Git unavailable'].includes(r.branch),
          )
          .sort(
            (a, b) =>
              Number(/^(main|master|trunk)$/.test(a.branch)) -
              Number(/^(main|master|trunk)$/.test(b.branch)),
          );
        const checks: { repositoryId: string; request: PullRequestSummary }[] = [];
        const checkWorkers: Promise<void>[] = [];
        let checking = 0;
        const loadChecks = async () => {
          checking++;
          try {
            while (!cancelled && checks.length) {
              const { repositoryId, request } = checks.shift()!;
              const value = await desktop
                .call('pr.checks', {
                  sessionId: session.id,
                  repositoryId,
                  ref: request.ref,
                })
                .catch((error: unknown) => ({
                  headRefOid: request.headRefOid,
                  statusCheckRollup: request.statusCheckRollup ?? [],
                  checksError: error instanceof Error ? error.message : String(error),
                }));
              if (cancelled || (request.headRefOid && value.headRefOid !== request.headRefOid))
                continue;
              updateBranchRequests(session.id, (values) => {
                const result = values[repositoryId];
                if (result?.identity !== identities[repositoryId] || !result.page) return values;
                return {
                  ...values,
                  [repositoryId]: {
                    ...result,
                    page: {
                      ...result.page,
                      items: result.page.items.map((item) =>
                        JSON.stringify(item.ref) === JSON.stringify(request.ref) &&
                        (!item.headRefOid || item.headRefOid === value.headRefOid)
                          ? { ...item, ...value }
                          : item,
                      ),
                    },
                  },
                };
              });
            }
          } finally {
            checking--;
          }
        };
        const load = async () => {
          while (!cancelled && pending.length) {
            const repository = pending.shift()!;
            const result: BranchRequestResult = { identity: identities[repository.id] };
            try {
              const remotes = await desktop.call('pr.remotes', {
                sessionId: session.id,
                repositoryId: repository.id,
              });
              if (cancelled) return;
              if (remotes.selected)
                result.page = await desktop.call('pr.list', {
                  sessionId: session.id,
                  repositoryId: repository.id,
                  scope: 'branch',
                  state: 'open',
                  page: 1,
                });
              if (!cancelled)
                checks.push(
                  ...(result.page?.items || [])
                    .filter((request) => request.ref.provider === 'gitlab')
                    .map((request) => ({ repositoryId: repository.id, request })),
                );
            } catch (error) {
              result.error = error instanceof Error ? error.message : String(error);
            }
            if (!cancelled)
              updateBranchRequests(session.id, (values) => {
                const previous =
                  values[repository.id]?.identity === result.identity
                    ? values[repository.id]?.page
                    : undefined;
                return {
                  ...values,
                  [repository.id]: {
                    ...result,
                    page: result.error
                      ? previous
                      : result.page && {
                          ...result.page,
                          items: result.page.items.map((request) => {
                            const old = previous?.items.find(
                              (item) =>
                                JSON.stringify(item.ref) === JSON.stringify(request.ref) &&
                                (item.headRefOid === request.headRefOid ||
                                  (!request.headRefOid && item.updatedAt === request.updatedAt)),
                            );
                            return old && request.ref.provider === 'gitlab'
                              ? {
                                  ...request,
                                  statusCheckRollup: old.statusCheckRollup,
                                  checksError: old.checksError,
                                }
                              : request;
                          }),
                        },
                  },
                };
              });
            while (!cancelled && checking < 2 && checks.length) checkWorkers.push(loadChecks());
          }
        };
        await Promise.all([load(), load()]);
        await Promise.all(checkWorkers);
      } catch (error) {
        if (!cancelled) useApp.getState().fail(error);
      } finally {
        running = false;
        if (!cancelled) setLoading(false);
        if (!cancelled && !document.hidden) timer = setTimeout(() => void refresh(), 60_000);
      }
    };
    const wake = () => {
      if (document.hidden) clearTimeout(timer);
      else void refresh();
    };
    void refresh();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [session.id, identities, token]);
  useEffect(
    () =>
      desktop.onEvent((event) => {
        if (
          (event.type === 'pr.changed' && event.sessionId === session.id) ||
          (event.type === 'operation' &&
            event.operation.sessionId === session.id &&
            event.operation.phase === 'completed' &&
            event.operation.pullRequest)
        )
          setToken((value) => value + 1);
      }),
    [session.id],
  );
  const entries = repositories.flatMap((repository) => {
    const result = results[repository.id];
    if (result?.identity !== identities[repository.id]) return [];
    return (result.page?.items || []).map((request) => ({ repository, request }));
  });
  if (!repositories.length) return null;
  return (
    <div
      className="island-requests my-1 empty:hidden"
      aria-label="Branch requests"
      aria-busy={loading}
    >
      {(expanded ? entries : entries.slice(0, 3)).map(({ repository, request }) => {
        const label = `${request.ref.provider === 'gitlab' ? 'MR !' : 'PR #'}${request.number}`;
        const Icon = request.draft ? GitPullRequestDraft : GitPullRequest;
        return (
          <div
            className="island-request grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 px-[11px] py-[5px]"
            key={repository.id + JSON.stringify(request.ref)}
          >
            <button
              className="island-row island-request-title col-span-full grid grid-cols-subgrid border-x-0 px-0 pb-0"
              aria-label={`Open ${label} in ${repository.path || 'Root'}`}
              title={`${request.title}\n${request.headRefName} → ${request.baseRefName}`}
              onClick={() =>
                showSurface(
                  { kind: 'pr', repositoryId: repository.id, ref: request.ref },
                  session.id,
                )
              }
            >
              <Icon size={14} className="text-[var(--success-foreground)]" aria-hidden />
              <span>{request.title}</span>
            </button>
            <div className="island-request-meta col-start-2 flex items-center gap-1.5 text-muted-foreground [font-size:var(--text-2xs)]">
              <button
                className="min-w-0 truncate p-0 text-left"
                onClick={() =>
                  showSurface(
                    { kind: 'pr', repositoryId: repository.id, ref: request.ref },
                    session.id,
                  )
                }
                title={repository.path || 'Root'}
              >
                {label} · {repository.path || 'Root'}
              </button>
              <RequestCI
                checks={request.statusCheckRollup}
                error={request.checksError}
                onShowAll={() =>
                  showSurface(
                    {
                      kind: 'pr',
                      repositoryId: repository.id,
                      ref: request.ref,
                      revealChecks: crypto.randomUUID(),
                    },
                    session.id,
                  )
                }
              />
            </div>
          </div>
        );
      })}
      {entries.length > 3 && (
        <button className="island-row muted" onClick={() => setExpanded(!expanded)}>
          <span>{expanded ? 'Show less' : `Show ${entries.length - 3} more`}</span>
        </button>
      )}
      {repositories.map((repository) => {
        const result = results[repository.id];
        if (
          result?.identity !== identities[repository.id] ||
          (!result.error && !result.page?.hasMore)
        )
          return null;
        return (
          <button
            className="island-row"
            key={repository.id}
            title={result.error}
            onClick={() => showSurface({ kind: 'pr', repositoryId: repository.id }, session.id)}
          >
            {result.error ? (
              <CircleAlert size={14} aria-hidden />
            ) : (
              <GitPullRequest size={14} aria-hidden />
            )}
            <span>
              {result.error ? 'Requests unavailable' : 'More requests'}
              <small>{repository.path || 'Root'}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
