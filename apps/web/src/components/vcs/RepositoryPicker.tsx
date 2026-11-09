import { Fragment, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Check, ChevronDown, FolderGit2, GitBranch, Search, X } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { selectedRepositories } from '~/state/repositories';
import { DiffStat } from './DiffStat';

const chipClassName =
  'inline-flex min-w-0 max-w-[145px] items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--foreground)_7%,var(--popover))] px-1.5 py-0.5 text-xs leading-5 [&>svg]:text-muted-foreground [&>span]:truncate';

export function RepositoryPicker({ session, disabled }: { session: Session; disabled: boolean }) {
  const repositories = useApp((s) => s.repositories[session.id]) || [];
  const statuses = useApp((s) => s.repositoryGit[session.id]);
  const errors = useApp((s) => s.repositoryErrors[session.id]);
  const ids = useApp((s) => s.views[session.id]?.repositoryIds) || [];
  const selected = selectedRepositories(repositories, ids);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const anchor = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const name = (path: string) => path.split('/').at(-1) || session.path.split('/').at(-1) || 'Root';
  const choose = (next: string[]) => {
    useApp.getState().setView({ repositoryIds: next }, session.id);
    void useApp.getState().refreshRepositoryGit(session.id, next).catch(useApp.getState().fail);
  };
  const filtered = repositories
    .filter((r) => `${r.path} ${r.branch}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(ids.includes(b.id)) - Number(ids.includes(a.id)));
  const firstUnselected = filtered.findIndex((r) => !ids.includes(r.id));
  return (
    <Popover.Root
      open={open}
      modal={false}
      onOpenChange={(next, details) => {
        if (
          !next &&
          details.reason === 'outside-press' &&
          details.event.target instanceof Node &&
          anchor.current?.contains(details.event.target)
        )
          return;
        setOpen(next);
        if (!next) setQuery('');
        else
          void useApp
            .getState()
            .refreshRepositoryGit(
              session.id,
              repositories.map((r) => r.id),
            )
            .catch(useApp.getState().fail);
      }}
    >
      <div className="text-caption m-0 px-[var(--floating-content-inset)] pt-2">
        Select repository
      </div>
      <div
        className="group/repository-picker relative p-[var(--sidebar-content-inset)]"
        ref={anchor}
      >
        <Popover.Trigger
          className="flex min-h-8 w-full items-center gap-2 rounded-[var(--control-radius)] p-[calc(var(--floating-content-inset)-var(--sidebar-content-inset))] text-left [font-size:var(--text-xs)] enabled:group-hover/repository-picker:bg-accent enabled:group-focus-within/repository-picker:bg-accent [&>svg]:text-muted-foreground data-[popup-open]:[&>svg]:rotate-180"
          aria-label="Select repositories"
          disabled={disabled}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1 pr-6" aria-live="polite">
            {!selected.length ? (
              <span className="text-muted-foreground">Choose repositories…</span>
            ) : selected.length === repositories.length ? (
              <span className={chipClassName}>
                <FolderGit2 size={12} />
                <span>All repositories</span>
              </span>
            ) : (
              <>
                {selected.slice(0, 2).map((r) => (
                  <span className={chipClassName} key={r.id} title={r.path || session.path}>
                    <FolderGit2 size={12} />
                    <span>{name(r.path)}</span>
                  </span>
                ))}
                {selected.length > 2 && (
                  <span
                    className={`${chipClassName} flex-none text-muted-foreground`}
                    title={selected
                      .slice(2)
                      .map((r) => r.path || session.path)
                      .join(', ')}
                  >
                    +{selected.length - 2}
                  </span>
                )}
              </>
            )}
          </span>
          <ChevronDown size={14} />
        </Popover.Trigger>
        <button
          type="button"
          className="absolute top-1/2 right-9 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground enabled:hover:[background:var(--accent)] enabled:hover:text-foreground"
          aria-label="Clear repository selection"
          disabled={disabled || !ids.length}
          onClick={() => choose([])}
        >
          <X size={14} />
        </button>
      </div>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[120] w-[var(--anchor-width)] max-w-[calc(100vw-16px)]"
        >
          <Popover.Popup
            className="flex max-h-[min(320px,var(--available-height))] flex-col overflow-hidden rounded-[var(--floating-radius)] border border-solid border-border bg-popover shadow-[var(--shadow-popover)] outline-none [font-size:var(--text-detail)]"
            aria-label="Repositories"
            initialFocus={search}
          >
            <div className="flex flex-none items-center gap-2 border-0 border-b border-solid border-border px-[var(--floating-content-inset)] py-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
                <Search size={14} />
                <input
                  className="w-0 min-w-0 flex-1 border-0 bg-transparent p-0 leading-5 focus-visible:outline-none [font-size:var(--text-detail)]"
                  ref={search}
                  type="search"
                  aria-label="Find repository"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="text-xs leading-5 text-muted-foreground"
                onClick={() => choose(repositories.map((r) => r.id))}
              >
                All
              </button>
              <button
                type="button"
                className="text-xs leading-5 text-muted-foreground"
                onClick={() => choose([])}
              >
                Clear
              </button>
            </div>
            <div className="min-h-0 overflow-auto p-[var(--sidebar-content-inset)]">
              {filtered.map((r, index) => (
                <Fragment key={r.id}>
                  {index > 0 && index === firstUnselected && (
                    <div role="separator" className="mx-2 my-1 h-px bg-border" />
                  )}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[var(--control-radius)] px-2 py-1.5 text-left hover:[background:var(--sidebar)]"
                    role="checkbox"
                    aria-label={`Select ${r.path || 'root'}`}
                    aria-checked={ids.includes(r.id)}
                    title={errors?.[r.id] || r.path || session.path}
                    onClick={() =>
                      choose(ids.includes(r.id) ? ids.filter((id) => id !== r.id) : [...ids, r.id])
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block min-w-0 truncate">{name(r.path)}</span>
                      <small className="flex items-center gap-[5px] text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                        <GitBranch size={12} />
                        {errors?.[r.id] ? 'Git status unavailable' : r.branch}
                      </small>
                    </span>
                    {statuses?.[r.id] ? (
                      <DiffStat changes={statuses[r.id].changes} />
                    ) : (
                      <span className="text-muted-foreground">…</span>
                    )}
                    <span className="inline-flex size-4 flex-none items-center justify-center text-foreground">
                      {ids.includes(r.id) && <Check size={14} />}
                    </span>
                  </button>
                </Fragment>
              ))}
              {!filtered.length && <p className="field-hint">No matching repositories.</p>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
