import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Popover } from '@base-ui/react/popover';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileDiff, FolderGit2, GitBranch, Tag } from 'lucide-react';
import type { GitHistoryCommit } from '@superfluid/contracts';
import { OverflowChips } from '~/components/ui/OverflowChips';
import { historyKey, type HistoryEntry } from './historyTimeline';
import { historyRowHeight, laneX, layoutHistory } from './layoutHistory';
import { CommitCard, formatDate } from './CommitCard';
import { HistorySubject } from './HistorySubject';

const laneTones = [
  '[--lane-color:var(--primary)]',
  '[--lane-color:var(--pr-foreground)]',
  '[--lane-color:var(--success-foreground)]',
  '[--lane-color:var(--warning-foreground)]',
  '[--lane-color:var(--error-foreground)]',
];
const laneTone = (lane: number) => laneTones[lane % laneTones.length];
const refBadge =
  'inline-flex h-5 max-w-60 items-center gap-1 rounded-full border border-solid px-1.5 font-mono text-[length:var(--text-2xs)] font-medium whitespace-nowrap [&>span]:min-w-0';
const neutralRef = 'border-border bg-card text-muted-foreground';
const branchRef =
  'border-transparent bg-[color-mix(in_srgb,var(--lane-color)_13%,transparent)] text-(--lane-color)';
const date = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const rowSize = () => historyRowHeight;
// Samples of the reference spring (stiffness 600, damping 44).
const previewSlide =
  'motion-safe:transition-[transform,top,right,bottom,left] motion-safe:duration-300 motion-safe:ease-[linear(0,.13,.366,.584,.748,.858,.926,.965,.986,.996,1,1.001,1)] data-[instant]:transition-none';

type Card = { entry: HistoryEntry; tone: string };

const HistoryRefs = memo(function HistoryRefs({ refs }: { refs: GitHistoryCommit['refs'] }) {
  return (
    <span
      className="w-fit max-w-full min-w-0 justify-self-end"
      title={refs.map((ref) => ref.name).join(', ')}
    >
      <OverflowChips
        overlap
        chips={refs.map((ref) => ({
          key: `${ref.kind}:${ref.name}`,
          label: ref.name,
          content: (
            <span
              className={`${refBadge} ${ref.kind === 'tag' ? neutralRef : branchRef} data-[kind=head]:ring-1 data-[kind=head]:ring-current/40`}
              data-kind={ref.kind}
            >
              {ref.kind === 'tag' ? <Tag size={12} /> : <GitBranch size={12} />}
              <span className="truncate">{ref.name}</span>
            </span>
          ),
        }))}
      />
    </span>
  );
});

export function HistoryGraph({
  entries,
  sessionId,
  filtered,
  showRepository,
  rootName,
  onLoadMore,
  onOpenChanges,
}: {
  entries: HistoryEntry[];
  sessionId: string;
  filtered: boolean;
  showRepository: boolean;
  rootName: string;
  onLoadMore?: () => void;
  onOpenChanges: (entry: HistoryEntry) => void;
}) {
  const id = useId();
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>();
  const [card] = useState(() => Popover.createHandle<Card>());
  const indices = useMemo(
    () => new Map(entries.map((entry, index) => [entry.key, index])),
    [entries],
  );
  const index = (selected && indices.get(selected)) || 0;
  const graph = useMemo(() => {
    const matches = filtered ? new Set(entries.map(({ key }) => key)) : undefined;
    return layoutHistory(
      entries.map(({ key, repository, commit }) => {
        const parents = commit.parents.map((parent) => historyKey(repository, parent));
        return {
          hash: key,
          parents: matches ? parents.filter((parent) => matches.has(parent)) : parents,
        };
      }),
    );
  }, [entries, filtered]);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: rowSize,
  });
  const visible = virtualizer.getVirtualItems();
  const range = virtualizer.range;
  useEffect(() => {
    if (!onLoadMore || !bottom.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        onLoadMore();
      },
      { root: scroll.current, rootMargin: '0px 0px 256px 0px' },
    );
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <>
      <div
        className="relative flex-1 overflow-auto focus-visible:-outline-offset-2"
        ref={scroll}
        role="listbox"
        aria-label="Commits"
        aria-keyshortcuts="Enter Shift+Enter"
        aria-activedescendant={
          visible.some((row) => row.index === index) ? `${id}-${index}` : undefined
        }
        tabIndex={0}
        onPointerOver={(event) => {
          if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
          const branch =
            event.target.closest('[data-history-branch]')?.getAttribute('data-history-branch') ??
            '';
          const style = event.currentTarget.style;
          if (style.getPropertyValue('--history-hover-branch') !== branch)
            style.setProperty('--history-hover-branch', branch);
        }}
        onPointerLeave={(event) =>
          event.currentTarget.style.removeProperty('--history-hover-branch')
        }
        onScroll={() => {
          if (card.isOpen) card.close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && card.isOpen) {
            event.preventDefault();
            card.close();
            return;
          }
          if (event.target instanceof HTMLButtonElement) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (event.key === 'Enter' && event.shiftKey) {
              if (card.isOpen) card.close();
              onOpenChanges(entries[index]);
              return;
            }
            const row = event.currentTarget.ownerDocument.getElementById(`${id}-${index}`);
            row?.focus({ preventScroll: true });
            row?.click();
            return;
          }
          const next = {
            ArrowUp: index - 1,
            ArrowDown: index + 1,
            Home: 0,
            End: entries.length - 1,
          }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          const position = Math.max(0, Math.min(next, entries.length - 1));
          setSelected(entries[position].key);
          virtualizer.scrollToIndex(position);
        }}
      >
        <div
          className="relative"
          role="presentation"
          style={{
            height: virtualizer.getTotalSize(),
            minWidth: graph.width + (showRepository ? 240 : 200),
          }}
        >
          {visible.map(({ index: row, start, size }) => {
            const entry = entries[row];
            const { commit, repository } = entry;
            const { lane, branch, lines, width } = graph.rows[row];
            const branchTransition =
              range && row >= range.startIndex && row <= range.endIndex
                ? 'motion-safe:transition-[stroke-opacity] motion-safe:duration-150'
                : '';
            const subject = commit.subject || '(No commit message)';
            const refNames = commit.refs.map((ref) => ref.name).join(', ');
            const shortDate = formatDate(commit.date, date);
            const tone = laneTone(lane);
            const repositoryName = repository.path.split('/').at(-1) || rootName;
            return (
              <Popover.Trigger
                key={entry.key}
                id={`${id}-${row}`}
                handle={card}
                payload={{ entry, tone }}
                openOnHover
                delay={250}
                closeDelay={100}
                nativeButton={false}
                render={<div />}
                tabIndex={-1}
                data-history-branch={branch}
                className={`absolute inset-x-0 flex cursor-pointer items-center gap-2 bg-(--history-row-background) pr-3 pl-1 shadow-[inset_0_-1px_color-mix(in_srgb,var(--border)_60%,transparent)] [--history-row-background:var(--background)] hover:[--history-row-background:var(--accent)] aria-selected:[--history-row-background:color-mix(in_srgb,var(--primary)_12%,var(--background))] ${tone}`}
                role="option"
                aria-selected={row === index}
                aria-posinset={row + 1}
                aria-setsize={entries.length}
                aria-label={[
                  subject,
                  showRepository ? repository.path || repositoryName : undefined,
                  commit.author,
                  shortDate,
                  commit.hash.slice(0, 8),
                  refNames,
                ]
                  .filter(Boolean)
                  .join(', ')}
                style={{ top: start, height: size }}
                onClick={() => setSelected(entry.key)}
              >
                <div
                  className={`grid min-w-0 flex-1 items-center ${commit.refs.length ? 'grid-cols-[minmax(0,max-content)_minmax(calc(var(--history-count-characters)*1ch+14px),1fr)] gap-2 font-mono text-[length:var(--text-2xs)]' : 'grid-cols-[minmax(0,1fr)]'}`}
                  style={
                    {
                      '--history-count-characters': String(commit.refs.length).length + 1,
                    } as CSSProperties
                  }
                >
                  <div className="flex min-w-0 items-center font-sans text-[length:var(--text-xs)]">
                    {showRepository && (
                      <span
                        className="me-0.5 flex w-20 shrink-0 justify-end @max-[480px]/history:w-16"
                        title={repository.path || repositoryName}
                      >
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-muted-foreground">
                          <FolderGit2 size={12} aria-hidden />
                          <span className="min-w-0 truncate">{repositoryName}</span>
                        </span>
                      </span>
                    )}
                    <svg
                      className="shrink-0"
                      width={width}
                      height={historyRowHeight}
                      aria-hidden="true"
                    >
                      {lines.map((line) => (
                        <path
                          key={line.path}
                          d={line.path}
                          className={`history-branch-opacity fill-none stroke-(--lane-color) stroke-[1.5] ${branchTransition} ${laneTone(line.lane)}`}
                          style={{ '--history-branch': line.branch } as CSSProperties}
                        />
                      ))}
                      <circle
                        cx={laneX(lane)}
                        cy={historyRowHeight / 2}
                        r={commit.parents.length > 1 ? 5 : 3.5}
                        className={`history-branch-opacity fill-(--history-row-background) stroke-(--lane-color) stroke-2 ${branchTransition}`}
                        style={{ '--history-branch': branch } as CSSProperties}
                      />
                    </svg>
                    <HistorySubject subject={subject} />
                  </div>
                  {!!commit.refs.length && <HistoryRefs refs={commit.refs} />}
                </div>
                <button
                  type="button"
                  tabIndex={-1}
                  className="flex size-6 shrink-0 items-center justify-center rounded-(--control-radius) text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                  title="Changes"
                  aria-label="Show commit changes"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (card.isOpen) card.close();
                    onOpenChanges(entry);
                  }}
                >
                  <FileDiff size={14} aria-hidden />
                </button>
                <time
                  className="w-[92px] shrink-0 text-right whitespace-nowrap text-muted-foreground @max-[540px]/history:hidden"
                  dateTime={commit.date}
                >
                  {shortDate}
                </time>
                <code className="shrink-0 whitespace-nowrap text-muted-foreground @max-[360px]/history:hidden">
                  {commit.hash.slice(0, 8)}
                </code>
              </Popover.Trigger>
            );
          })}
          <div
            ref={bottom}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
            aria-hidden="true"
          />
        </div>
      </div>
      <Popover.Root handle={card}>
        {({ payload }) =>
          payload && (
            <Popover.Portal>
              <Popover.Positioner
                side="bottom"
                align="start"
                alignOffset={Math.min(graph.width + 4, 76) + (showRepository ? 64 : 0)}
                sideOffset={6}
                collisionPadding={8}
                className={`z-[120] w-80 max-w-[var(--available-width)] data-[anchor-hidden]:hidden ${previewSlide}`}
              >
                <Popover.Popup
                  ref={popup}
                  aria-label="Commit details"
                  initialFocus={(type) => (type === 'keyboard' ? popup.current : false)}
                  finalFocus={(type) => (type === 'keyboard' ? scroll.current : false)}
                  onKeyDownCapture={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    card.close();
                    scroll.current?.focus({ preventScroll: true });
                  }}
                  className={`origin-(--transform-origin) rounded-xl border border-solid border-border bg-popover p-3 text-xs text-foreground shadow-[var(--shadow-popover)] outline-none motion-safe:transition-[scale,opacity] motion-safe:duration-150 motion-safe:ease-[cubic-bezier(.23,1,.32,1)] data-[ending-style]:scale-[.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[.97] data-[starting-style]:opacity-0 ${payload.tone}`}
                >
                  <CommitCard
                    sessionId={sessionId}
                    entry={payload.entry}
                    showRepository={showRepository}
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          )
        }
      </Popover.Root>
    </>
  );
}
