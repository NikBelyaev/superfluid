import { ArrowUpRight } from 'lucide-react';
import type { SearchMatch } from '@superfluid/contracts';
import type { Ref } from 'react';
import { typeIcons, typeLabels } from './SearchFilters';
import { Highlight } from './Highlight';

export function SearchResultRow({
  match,
  query,
  selected,
  id,
  rowRef,
  select,
  open,
}: {
  match: SearchMatch;
  query: string;
  selected: boolean;
  id: string;
  rowRef?: Ref<HTMLDivElement>;
  select: () => void;
  open: () => void;
}) {
  const Icon = typeIcons[match.type];
  return (
    <div
      id={id}
      ref={rowRef}
      role="option"
      aria-selected={selected}
      data-type={match.type}
      data-path={match.path}
      className="group/result flex min-w-0 cursor-pointer items-start gap-3.5 rounded-[9px] px-3.5 py-4 hover:bg-accent aria-selected:bg-accent group-focus-visible/results:aria-selected:outline-1 group-focus-visible/results:aria-selected:-outline-offset-1 group-focus-visible/results:aria-selected:outline-ring @max-[600px]/search:gap-2 @max-[600px]/search:px-2 @max-[600px]/search:py-3"
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse' && !selected) select();
      }}
      onClick={select}
      onDoubleClick={open}
    >
      <Icon
        className="mt-[3px] shrink-0 text-muted-foreground"
        size={18}
        aria-label={typeLabels[match.type]}
      />
      <div className="min-w-0 flex-1">
        <strong className="block text-base leading-[21px] font-medium [overflow-wrap:anywhere]">
          {match.containerName && (
            <span className="text-muted-foreground">{match.containerName}.</span>
          )}
          <Highlight text={match.name ?? match.path.split('/').at(-1)!} query={query} />
        </strong>
        <span className="mt-[3px] flex items-baseline gap-2 text-xs leading-[19px] text-muted-foreground">
          <span className="min-w-0 truncate">
            {match.path}
            {match.line ? `:${match.line}` : ''}
          </span>
        </span>
        {match.text && (
          <p
            className={`my-2 line-clamp-2 text-xs leading-5 text-secondary-foreground [overflow-wrap:anywhere] ${match.type === 'document' ? 'font-sans' : 'font-mono'}`}
          >
            <Highlight text={match.text.trim()} query={query} />
          </p>
        )}
      </div>
      <ArrowUpRight
        size={14}
        className="mt-[3px] shrink-0 text-muted-foreground opacity-0 group-hover/result:opacity-100 group-aria-selected/result:opacity-100"
      />
    </div>
  );
}
