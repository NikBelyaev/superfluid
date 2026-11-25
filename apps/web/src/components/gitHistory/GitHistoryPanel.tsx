import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { GitRepository, Session } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { showSurface, useApp } from '~/state/workspaceStore';
import type { TabGroup } from '~/state/workspaceView';
import { RepositoryPicker } from '~/components/vcs/RepositoryPicker';
import { HistoryGraph } from './HistoryGraph';
import { HistorySkeleton } from './HistorySkeleton';
import { historyTimeline, type HistoryCursor, type HistoryStream } from './historyTimeline';

const islandInset =
  '[@container_editor_(width>560px)]:me-[calc(var(--island-width)+30px)] [@container_editor_(width>560px)]:border-e';
const searchLimit = 256;

export default function GitHistoryPanel({
  session,
  group,
  repositoryIds,
}: {
  session: Session;
  group: TabGroup;
  repositoryIds?: string[];
}) {
  const repositories = useApp((state) => state.repositories[session.id]);
  const projectName = useApp(
    (state) => state.projects.find(({ id }) => id === session.projectId)?.name,
  );
  const island = useApp((state) => group === 'main' && state.island);
  const [refresh, setRefresh] = useState(0);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const changeSearch = (value: string) => {
    setInput(value);
    if (!value.trim()) setQuery('');
  };
  useEffect(() => {
    const term = input.trim();
    if (!term) return;
    const timer = setTimeout(() => setQuery(term), 200);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    const typeInSearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key === ' ' ||
        [...event.key].length !== 1
      )
        return;
      const surface = panel.current;
      const field = search.current;
      if (!surface || !field || field.disabled) return;
      const focused = document.activeElement;
      if (
        focused?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        )
      )
        return;
      const focusedHistory = focused?.closest('[data-git-history]');
      if (focusedHistory ? focusedHistory !== surface : !surface.matches(':hover')) return;

      event.preventDefault();
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
      setInput((value) => (value + event.key).slice(0, searchLimit));
    };
    document.addEventListener('keydown', typeInSearch);
    return () => document.removeEventListener('keydown', typeInSearch);
  }, []);
  const selection = useMemo(() => {
    if (!repositories) return [];
    if (!repositoryIds) return repositories;
    const ids = new Set(repositoryIds);
    return repositories.filter(({ id }) => ids.has(id));
  }, [repositories, repositoryIds]);

  if (!repositories) return <HistorySkeleton />;
  if (!repositories.length)
    return (
      <div className="surface-empty" role="status">
        No Git repositories in this worktree.
      </div>
    );

  return (
    <div
      ref={panel}
      data-git-history
      className={`@container/history flex min-h-0 min-w-0 flex-1 flex-col border-0 border-solid border-border text-[length:var(--text-xs)] ${island ? islandInset : ''}`}
    >
      <header className="flex min-h-[38px] flex-none flex-wrap items-end gap-x-2 border-0 border-b border-solid border-border bg-card pe-2">
        {repositories.length > 1 ? (
          <div className="min-w-0 max-w-lg flex-1">
            <RepositoryPicker
              session={session}
              ids={selection.map(({ id }) => id)}
              onChange={(ids) =>
                showSurface({ kind: 'git-history', repositoryIds: ids }, session.id, group)
              }
            />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate self-center px-3 font-medium">
            {repositories[0].path || 'Root repository'}
          </span>
        )}
        <div
          role="search"
          className="order-last w-full min-w-0 px-2 pb-2 @min-[640px]/history:order-none @min-[640px]/history:ms-auto @min-[640px]/history:w-52 @min-[640px]/history:px-0 @min-[640px]/history:pb-1.5"
        >
          <label className="flex h-7 min-w-0 items-center gap-2 rounded-(--control-radius) border border-solid border-border bg-background px-2 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
            <Search size={14} aria-hidden />
            <input
              ref={search}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground focus-visible:outline-none placeholder:text-muted-foreground"
              type="search"
              aria-label="Search commit messages"
              placeholder="Search commits…"
              maxLength={searchLimit}
              value={input}
              disabled={!selection.length}
              onChange={(event) => changeSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || !input) return;
                event.preventDefault();
                event.stopPropagation();
                changeSearch('');
              }}
            />
          </label>
        </div>
        <button
          type="button"
          className="icon-button ms-auto mb-1.5 shrink-0 @min-[640px]/history:ms-0"
          aria-label="Refresh Git history"
          title="Refresh Git history"
          disabled={!selection.length}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      {selection.length ? (
        <RepositoryHistory
          key={JSON.stringify([refresh, query, selection.map(({ id }) => id)])}
          sessionId={session.id}
          group={group}
          repositories={selection}
          query={query}
          rootName={projectName || session.path.split('/').at(-1) || 'Root'}
        />
      ) : (
        <div className="surface-empty" role="status">
          Choose repositories to view their history.
        </div>
      )}
    </div>
  );
}

type HistoryRequest = { repository: GitRepository; cursor: HistoryCursor } | null;

function RepositoryHistory({
  sessionId,
  group,
  repositories,
  rootName,
  query,
}: {
  sessionId: string;
  group: TabGroup;
  repositories: GitRepository[];
  rootName: string;
  query: string;
}) {
  const [sources] = useState(repositories);
  const [request, setRequest] = useState<HistoryRequest>(null);
  const [response, setResponse] = useState<{ request: HistoryRequest; streams: HistoryStream[] }>();
  const streams = response?.streams;
  const loading = response?.request !== request;
  const timeline = useMemo(() => streams && historyTimeline(streams), [streams]);

  useEffect(() => {
    let disposed = false;
    const read = async (
      repository: GitRepository,
      cursor?: HistoryCursor,
    ): Promise<HistoryStream> => {
      try {
        const result = await desktop.call('git.history', {
          sessionId,
          repositoryId: repository.id,
          cursor,
          query,
        });
        return { ...result, repository };
      } catch (error) {
        return {
          repository,
          commits: [],
          next: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };
    const load = async () => {
      if (request) {
        const page = await read(request.repository, request.cursor);
        if (disposed) return;
        setResponse((previous) => ({
          request,
          streams: (previous?.streams ?? []).map((stream) =>
            stream.repository.id === page.repository.id
              ? { ...page, commits: [...stream.commits, ...page.commits] }
              : stream,
          ),
        }));
        return;
      }
      const pages: HistoryStream[] = [];
      for (let index = 0; index < sources.length; index += 4) {
        pages.push(
          ...(await Promise.all(
            sources.slice(index, index + 4).map((repository) => read(repository)),
          )),
        );
        if (disposed) return;
      }
      setResponse({ request, streams: pages });
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [request, sessionId, sources, query]);

  const next = timeline?.next;
  const loadMore = useCallback(() => {
    if (next?.next) setRequest({ repository: next.repository, cursor: next.next });
  }, [next]);
  const errors = streams?.filter((stream) => stream.error);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-busy={loading}>
      {!!errors?.length && (
        <div
          className="max-h-24 shrink-0 overflow-auto px-3 py-2 text-error-foreground"
          role="alert"
        >
          {errors.map(({ repository, error }) => (
            <div key={repository.id}>
              {repository.path || 'Root repository'} · {error}
            </div>
          ))}
        </div>
      )}
      {!response ? (
        <HistorySkeleton showRepository={repositories.length > 1} />
      ) : timeline?.entries.length ? (
        <HistoryGraph
          entries={timeline.entries}
          sessionId={sessionId}
          filtered={!!query}
          showRepository={repositories.length > 1}
          rootName={rootName}
          onLoadMore={!loading && next ? loadMore : undefined}
          onOpenChanges={({ commit, repository }) =>
            showSurface(
              { kind: 'diff', commit: { hash: commit.hash, repositoryId: repository.id } },
              sessionId,
              group,
            )
          }
        />
      ) : (
        <div className="surface-empty" role="status">
          {errors?.length
            ? 'No history available.'
            : query
              ? 'No commits match this search.'
              : 'No commits in the selected repositories.'}
        </div>
      )}
      {loading && !!timeline?.entries.length && (
        <span
          className="pointer-events-none absolute end-3 bottom-2 rounded-full bg-card px-3 py-1 text-muted-foreground shadow-sm"
          role="status"
        >
          Loading older commits…
        </span>
      )}
    </div>
  );
}
