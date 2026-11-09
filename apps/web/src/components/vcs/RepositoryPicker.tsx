import { Fragment, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Check, ChevronDown, FolderGit2, GitBranch, Search, X } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { selectedRepositories } from '~/state/repositories';
import { DiffStat } from './DiffStat';

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
      <div className="text-caption repository-field-caption repository-picker-caption">
        Select repository
      </div>
      <div className="repository-chip-bar" ref={anchor}>
        <Popover.Trigger
          className="repository-chip-field"
          aria-label="Select repositories"
          disabled={disabled}
        >
          <span className="repository-chips" aria-live="polite">
            {!selected.length ? (
              <span className="muted">Choose repositories…</span>
            ) : selected.length === repositories.length ? (
              <span className="repository-chip">
                <FolderGit2 size={12} />
                <span>All repositories</span>
              </span>
            ) : (
              <>
                {selected.slice(0, 2).map((r) => (
                  <span className="repository-chip" key={r.id} title={r.path || session.path}>
                    <FolderGit2 size={12} />
                    <span>{name(r.path)}</span>
                  </span>
                ))}
                {selected.length > 2 && (
                  <span
                    className="repository-chip repository-chip-extra"
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
          className="repository-chip-clear"
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
          className="repository-select-positioner"
        >
          <Popover.Popup
            className="repository-select-popup"
            aria-label="Repositories"
            initialFocus={search}
          >
            <div className="repository-select-tools">
              <label>
                <Search size={14} />
                <input
                  ref={search}
                  type="search"
                  aria-label="Find repository"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button type="button" onClick={() => choose(repositories.map((r) => r.id))}>
                All
              </button>
              <button type="button" onClick={() => choose([])}>
                Clear
              </button>
            </div>
            <div className="repository-select-list">
              {filtered.map((r, index) => (
                <Fragment key={r.id}>
                  {index > 0 && index === firstUnselected && (
                    <div role="separator" className="repository-select-separator" />
                  )}
                  <button
                    type="button"
                    className="repository-choice"
                    role="checkbox"
                    aria-label={`Select ${r.path || 'root'}`}
                    aria-checked={ids.includes(r.id)}
                    title={errors?.[r.id] || r.path || session.path}
                    onClick={() =>
                      choose(ids.includes(r.id) ? ids.filter((id) => id !== r.id) : [...ids, r.id])
                    }
                  >
                    <span className="repository-choice-label">
                      <span>{name(r.path)}</span>
                      <small>
                        <GitBranch size={12} />
                        {errors?.[r.id] ? 'Git status unavailable' : r.branch}
                      </small>
                    </span>
                    {statuses?.[r.id] ? (
                      <DiffStat changes={statuses[r.id].changes} />
                    ) : (
                      <span className="muted">…</span>
                    )}
                    <span className="repository-check">
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
