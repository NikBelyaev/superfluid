import { useState } from 'react';
import { Box, Braces, FileCode2, FileText, GitBranch, Search, TextSearch, X } from 'lucide-react';
import { searchTypes, type GitRepository, type SearchType } from '@superfluid/contracts';

export const typeLabels = {
  class: 'Classes',
  file: 'Files',
  document: 'Documents',
  symbol: 'Symbols',
  text: 'Text',
};
export const typeIcons = {
  class: Box,
  file: FileCode2,
  document: FileText,
  symbol: Braces,
  text: TextSearch,
};

export function SearchFilters({
  types,
  setTypes,
  repositories,
  excluded,
  setExcluded,
  project,
}: {
  types: SearchType[];
  setTypes: (types: SearchType[]) => void;
  repositories: GitRepository[];
  excluded: string[];
  setExcluded: (ids: string[]) => void;
  project: string;
}) {
  const [query, setQuery] = useState('');
  const name = (repository: GitRepository) => repository.path.split(/[\\/]/).at(-1) || project;
  const visible = repositories.filter((repository) =>
    name(repository).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const all = !repositories.some((repository) => excluded.includes(repository.id));
  const none = repositories.every((repository) => excluded.includes(repository.id));
  return (
    <aside
      className="overflow-auto border-0 border-r border-solid border-border bg-sidebar px-4 py-5 @max-[600px]/search:px-2.5 @max-[600px]/search:py-4"
      aria-label="Search filters"
    >
      <div className="mb-[22px] flex items-center justify-between text-sm leading-5">
        <strong className="font-medium">Filters</strong>
        {(types.length > 0 || excluded.length > 0) && (
          <button
            className="text-xs leading-5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setTypes([]);
              setExcluded([]);
            }}
          >
            Clear all
          </button>
        )}
      </div>
      <fieldset className="m-0 mb-7 min-w-0 border-0 p-0">
        <legend className="mb-2.5 p-0 text-xs leading-5 font-normal text-muted-foreground">
          Types
        </legend>
        <div className="flex flex-wrap gap-[7px]">
          {searchTypes.map((type) => {
            const Icon = typeIcons[type];
            return (
              <button
                key={type}
                type="button"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-solid border-border px-2.5 py-[5px] text-sm leading-5 text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-pressed={types.includes(type)}
                onClick={() =>
                  setTypes(
                    types.includes(type)
                      ? types.filter((value) => value !== type)
                      : [...types, type],
                  )
                }
              >
                <Icon size={14} />
                <span>{typeLabels[type]}</span>
                {types.includes(type) && <X size={12} />}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="m-0 mb-7 min-w-0 border-0 p-0">
        <legend className="mb-2.5 p-0 text-xs leading-5 font-normal text-muted-foreground">
          Repositories
        </legend>
        <div className="mt-0.5 mb-3 flex h-8 items-center gap-[7px] rounded-md border border-solid border-input bg-card px-[9px] text-muted-foreground focus-within:border-ring">
          <Search size={14} />
          <input
            className="w-full min-w-0 border-0 bg-transparent text-sm leading-5 text-foreground outline-none focus-visible:outline-none"
            type="search"
            aria-label="Filter repositories"
            placeholder="Find repository…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {repositories.length > 0 ? (
          <>
            <label className="mb-2 flex min-h-[34px] cursor-pointer items-center gap-[9px] text-sm leading-5 text-secondary-foreground">
              <input
                className="m-0 size-3.5 shrink-0 accent-primary"
                type="checkbox"
                checked={all}
                ref={(input) => {
                  if (input) input.indeterminate = !all && !none;
                }}
                onChange={() =>
                  setExcluded(all ? repositories.map((repository) => repository.id) : [])
                }
              />
              <span className="min-w-0 truncate">All repositories</span>
            </label>
            {visible.map((repository) => (
              <label
                key={repository.id}
                className="flex min-h-[34px] cursor-pointer items-center gap-[9px] text-sm leading-5 text-secondary-foreground"
              >
                <input
                  className="m-0 size-3.5 shrink-0 accent-primary"
                  type="checkbox"
                  aria-label={`Repository ${repository.path || project}`}
                  checked={!excluded.includes(repository.id)}
                  onChange={() =>
                    setExcluded(
                      excluded.includes(repository.id)
                        ? excluded.filter((id) => id !== repository.id)
                        : [...excluded, repository.id],
                    )
                  }
                />
                <span className="min-w-0 flex-1 overflow-hidden py-[5px] whitespace-nowrap">
                  <span className="block truncate" title={repository.path || project}>
                    {name(repository)}
                  </span>
                  <span
                    className="mt-[3px] flex items-center gap-[5px] text-xs leading-5 text-muted-foreground"
                    title={repository.branch}
                  >
                    <GitBranch size={12} />
                    <span className="truncate">{repository.branch}</span>
                  </span>
                </span>
              </label>
            ))}
            {!visible.length && (
              <p className="mt-2 mb-0 text-xs leading-[18px] text-muted-foreground">
                No matching repositories.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 mb-0 text-xs leading-[18px] text-muted-foreground">
            All files in this worktree
          </p>
        )}
      </fieldset>
    </aside>
  );
}
