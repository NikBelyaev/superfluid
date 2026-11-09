import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Search, X } from 'lucide-react';
import type { GitRepository, SearchType, Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import type { SearchFilterSelection } from '~/state/workspaceView';
import { SearchFilters, typeIcons, typeLabels } from './SearchFilters';
import { SearchPreview } from './SearchPreview';
import { SearchResultRow } from './SearchResultRow';
import { useSearch } from './useSearch';
import { useSearchWindow } from './useSearchWindow';

const noRepositories: GitRepository[] = [];
const defaultFilters = {
  files: { types: ['file', 'document'], excluded: [] },
  search: { types: [], excluded: [] },
  symbols: { types: ['class', 'symbol'], excluded: [] },
} satisfies Record<string, SearchFilterSelection>;
const chipClassName =
  'flex min-h-8 items-center gap-1.5 rounded-full border border-solid border-border bg-accent px-2.5 py-[5px] text-sm leading-5 text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--accent))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const keyClassName =
  'inline-flex h-5 min-w-5 items-center justify-center rounded bg-foreground/7 px-1 font-sans text-xs leading-5 font-medium whitespace-nowrap text-(--control-muted-foreground)';

export function SearchDialog({
  session,
  mode,
}: {
  session: Session;
  mode: 'files' | 'search' | 'symbols';
}) {
  const project = useApp((app) => app.projects.find((project) => project.id === session.projectId));
  const repositories = useApp((app) => app.repositories[session.id]) ?? noRepositories;
  const [query, setQuery] = useState('');
  const savedFilters = useApp((app) => app.views[session.id]?.searchFilters?.[mode]);
  const filters = savedFilters ?? defaultFilters[mode];
  const types = filters.types;
  const excluded = filters.excluded.filter((id) =>
    repositories.some((repository) => repository.id === id),
  );
  const setFilters = (patch: Partial<SearchFilterSelection>) => {
    const app = useApp.getState();
    const saved = app.views[session.id]?.searchFilters;
    app.setView(
      {
        searchFilters: {
          ...saved,
          [mode]: { ...defaultFilters[mode], ...saved?.[mode], ...patch },
        },
      },
      session.id,
    );
  };
  const setTypes = (types: SearchType[]) => setFilters({ types });
  const setExcluded = (excluded: string[]) => setFilters({ excluded });
  const [cursor, select] = useState({ stamp: '', index: 0, source: 'keyboard' });
  const { popup, expanded, heading } = useSearchWindow();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLDivElement>(null);
  const listId = useId();
  const repositoryIds = excluded.length
    ? repositories
        .filter((repository) => !excluded.includes(repository.id))
        .map((repository) => repository.id)
    : undefined;
  const scope = repositoryIds?.join(',');
  const { current, busy, error, stamp } = useSearch(session.id, query, types, scope);
  const index = cursor.stamp === stamp ? cursor.index : 0;
  const source = cursor.stamp === stamp ? cursor.source : 'keyboard';
  const setIndex = (index: number, source = 'keyboard') => select({ stamp, index, source });
  const hits = current?.hits ?? [];
  const hit = hits[index];
  const noScope = repositoryIds?.length === 0;
  useLayoutEffect(() => {
    if (source === 'keyboard') selected.current?.scrollIntoView({ block: 'nearest' });
  }, [index, current, source]);
  const open = async () => {
    if (!hit || useApp.getState().sessionId !== session.id) return;
    useApp.setState({ palette: null });
    try {
      const { documents } = await import('~/state/editor/Documents');
      const doc = documents.items.get(documents.key(session.id, hit.path));
      if (doc) await documents.refresh(doc);
      if (useApp.getState().sessionId === session.id)
        await useApp.getState().openFile(hit.path, hit.line, hit.column);
    } catch (error) {
      useApp.getState().fail(error);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) useApp.setState({ palette: null });
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-100 bg-black/16" />
        <Dialog.Popup
          ref={popup}
          data-expanded={expanded || undefined}
          className="@container/search fixed z-101 top-(--search-top) left-(--search-left) flex h-[min(740px,calc(100vh_-_48px))] max-h-[calc(100vh_-_var(--search-top)_-_16px)] min-h-[min(440px,calc(100vh_-_48px))] w-[min(1280px,calc(100vw_-_48px))] max-w-[calc(100vw_-_var(--search-left)_-_16px)] min-w-[min(720px,calc(100vw_-_48px))] resize flex-col overflow-hidden rounded-[28px] border border-solid border-border bg-card text-foreground outline-none [box-shadow:var(--shadow-dialog)] [--search-left:max(24px,calc((100vw_-_1280px)/2))] [--search-top:max(24px,calc((100vh_-_740px)/2))] data-[expanded=true]:h-[calc(100vh_-_32px)] data-[expanded=true]:w-[calc(100vw_-_32px)] data-[expanded=true]:resize-none data-[expanded=true]:[--search-left:16px] data-[expanded=true]:[--search-top:16px]"
          initialFocus={input}
          onKeyDownCapture={(event) => {
            const target = event.target as Element;
            if (target.closest('input:not([type="checkbox"]), textarea, [contenteditable]')) return;
            const modified =
              (event.ctrlKey || event.metaKey) && !event.getModifierState('AltGraph');
            const shortcut = modified && ['a', 'v', 'x'].includes(event.key.toLowerCase());
            const spaceControl =
              event.key === ' ' && target.closest('button, input[type="checkbox"]');
            const typing =
              !modified &&
              (([...event.key].length === 1 && !spaceControl) ||
                ['Backspace', 'Delete', 'Dead', 'Process'].includes(event.key) ||
                event.nativeEvent.isComposing);
            if (shortcut || typing) input.current?.focus();
          }}
          onKeyDown={(event) => {
            if (
              event.key === '/' &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !(event.target as Element).closest('input, textarea')
            ) {
              event.preventDefault();
              input.current?.focus();
            }
          }}
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <header
            className="shrink-0 cursor-grab touch-none bg-sidebar px-6 py-4 data-[dragging=true]:cursor-grabbing focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring @max-[600px]/search:px-3"
            {...heading}
          >
            <div className="flex h-[50px] shrink-0 items-center gap-3 rounded-[18px] border border-solid border-border bg-accent px-3.5 text-muted-foreground focus-within:border-input">
              <Search size={19} />
              <input
                className="h-full min-w-0 flex-1 cursor-text border-0 bg-transparent text-base leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
                ref={input}
                aria-label="Search worktree"
                placeholder="Search classes, files, documents, symbols and text…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-controls={listId}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && hits.length) {
                    event.preventDefault();
                    list.current?.focus();
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void open();
                  }
                }}
              />
              {query && (
                <button
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    input.current?.focus();
                  }}
                >
                  <X size={15} />
                </button>
              )}
              <kbd className={keyClassName} aria-hidden="true">
                /
              </kbd>
            </div>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-[264px_minmax(280px,1fr)_minmax(300px,34%)] border-0 border-t border-solid border-border @max-[1050px]/search:grid-cols-[244px_minmax(0,1fr)] @max-[600px]/search:grid-cols-[180px_minmax(0,1fr)]">
            <SearchFilters
              types={types}
              setTypes={setTypes}
              repositories={repositories}
              excluded={excluded}
              setExcluded={setExcluded}
              project={project?.name ?? 'Root'}
            />
            <section
              className="flex min-h-0 min-w-0 flex-col"
              aria-label="Search results"
              aria-busy={busy}
            >
              <div
                className="min-h-[50px] shrink-0 px-5 pt-[17px] pb-3 text-sm leading-5 text-muted-foreground tabular-nums"
                role="status"
                aria-live="polite"
              >
                {busy
                  ? 'Searching…'
                  : query.trim()
                    ? `${hits.length}${current?.truncated ? '+' : ''} results`
                    : null}
              </div>
              {(types.length > 0 || excluded.length > 0) && (
                <div className="flex flex-wrap gap-[7px] px-[18px] pb-3">
                  {types.map((type) => {
                    const Icon = typeIcons[type];
                    return (
                      <button
                        className={chipClassName}
                        key={type}
                        aria-label={`Remove ${typeLabels[type]} filter`}
                        onClick={() => setTypes(types.filter((value) => value !== type))}
                      >
                        <Icon size={14} />
                        <strong className="font-medium">{typeLabels[type]}</strong>
                        <X size={12} className="ml-1" />
                      </button>
                    );
                  })}
                  {excluded.length > 0 && (
                    <button
                      className={chipClassName}
                      aria-label="Reset repository filter"
                      onClick={() => setExcluded([])}
                    >
                      <span className="text-muted-foreground">Repositories</span>
                      <span className="text-muted-foreground" aria-hidden="true">
                        ·
                      </span>
                      <strong className="font-medium">{repositoryIds?.length ?? 0}</strong>
                      <X size={12} className="ml-1" />
                    </button>
                  )}
                </div>
              )}
              <div
                ref={list}
                className="group/results min-h-0 flex-1 overflow-auto px-2 pt-0 pb-2.5 outline-none focus-visible:outline-none"
                id={listId}
                role="listbox"
                aria-label="Matches"
                tabIndex={0}
                aria-activedescendant={hit ? `${listId}-${index}` : undefined}
                onKeyDown={(event) => {
                  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    setIndex(
                      Math.max(
                        0,
                        Math.min(
                          hits.length - 1,
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? hits.length - 1
                              : index + (event.key === 'ArrowDown' ? 1 : -1),
                        ),
                      ),
                    );
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    void open();
                  } else if (event.key === 'Escape') {
                    event.stopPropagation();
                    input.current?.focus();
                  }
                }}
              >
                {hits.map((match, i) => (
                  <SearchResultRow
                    key={`${match.type}:${match.path}:${match.line}:${match.column}`}
                    id={`${listId}-${i}`}
                    rowRef={i === index ? selected : undefined}
                    match={match}
                    query={query}
                    selected={i === index}
                    select={() => setIndex(i, 'pointer')}
                    open={() => void open()}
                  />
                ))}
                {!hits.length && !busy && (
                  <div className="flex min-h-[230px] flex-col items-center justify-center p-6 text-center">
                    <Search size={25} className="mb-4 text-muted-foreground" />
                    <strong className="text-base leading-5 font-medium">
                      {error
                        ? 'Search unavailable'
                        : noScope
                          ? 'Select a repository'
                          : query.trim()
                            ? 'No results found'
                            : 'Find something in your code'}
                    </strong>
                    <p className="my-[1em] text-sm leading-[21px] text-muted-foreground [overflow-wrap:anywhere]">
                      {error ||
                        (noScope
                          ? 'Choose at least one repository in the filters.'
                          : query.trim()
                            ? 'Try another query or broaden the filters.'
                            : 'Search by name or find text across your repositories.')}
                    </p>
                  </div>
                )}
                {busy && !hits.length && (
                  <p
                    className="p-3 text-sm leading-[21px] text-muted-foreground [overflow-wrap:anywhere]"
                    role="status"
                  >
                    Searching repositories…
                  </p>
                )}
              </div>
              {current?.warnings.map((warning) => (
                <p
                  className="mx-3 my-1.5 rounded-[5px] bg-[color-mix(in_srgb,var(--error-foreground)_8%,transparent)] px-3 py-2 text-sm leading-5 text-(--error-foreground) [overflow-wrap:anywhere]"
                  key={warning}
                >
                  {warning}
                </p>
              ))}
            </section>
            <SearchPreview
              key={hit ? `${stamp}:${hit.path}:${hit.line}` : 'empty'}
              hit={hit}
              session={session}
              query={query}
              open={() => void open()}
            />
          </div>
          <footer className="flex h-10 shrink-0 items-center gap-5 border-0 border-t border-solid border-border px-5 text-xs leading-5 text-muted-foreground @max-[600px]/search:gap-2.5 @max-[600px]/search:px-3">
            <span className="inline-flex items-center gap-[5px]">
              <kbd className={keyClassName}>↑</kbd>
              <kbd className={keyClassName}>↓</kbd> Navigate
            </span>
            <button
              className="inline-flex items-center gap-[5px] enabled:hover:text-foreground disabled:opacity-45"
              disabled={!hit}
              onClick={() => void open()}
            >
              <kbd className={keyClassName}>↵</kbd> Open file
            </button>
            <span className="min-w-0 flex-1" />
            {current?.truncated && (
              <span className="inline-flex items-center gap-[5px] @max-[600px]/search:hidden">
                Showing first 500 — narrow your search
              </span>
            )}
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
