import { useEffect, useState } from 'react';
import type { Input, Results } from '@superfluid/contracts';
import { Skeleton } from '~/components/ui/Skeleton';
import { desktop } from '~/rpc/desktop';
import type { HistoryEntry } from './historyTimeline';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(value: string, formatter: Intl.DateTimeFormat) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 'Unknown date' : formatter.format(time);
}

export function CommitCard({
  sessionId,
  entry,
  showRepository,
}: {
  sessionId: string;
  entry: HistoryEntry;
  showRepository: boolean;
}) {
  const { commit, repository } = entry;
  const initials = commit.author
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return (
    <>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent font-medium text-muted-foreground"
        >
          {initials || '?'}
        </span>
        <div className="min-w-0">
          <strong
            className="line-clamp-3 text-sm font-medium [overflow-wrap:anywhere]"
            title={commit.subject}
          >
            {commit.subject || '(No commit message)'}
          </strong>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-muted-foreground">
            <span>{commit.author}</span>
            <time dateTime={commit.date}>{formatDate(commit.date, dateTime)}</time>
          </div>
          {showRepository && (
            <div className="truncate text-muted-foreground" title={repository.path}>
              {repository.path || 'Root repository'}
            </div>
          )}
        </div>
      </div>
      {!!commit.refs.length && (
        <div
          className="mt-2 line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]"
          title={commit.refs.map((ref) => ref.name).join(', ')}
        >
          {commit.refs.map((ref) => ref.name).join(', ')}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 border-0 border-t border-solid border-border pt-2">
        <span className="size-2 shrink-0 rounded-full bg-(--lane-color)" aria-hidden />
        <code title={commit.hash}>{commit.hash.slice(0, 10)}</code>
        {commit.parents.length > 1 && (
          <span className="truncate text-muted-foreground" title={commit.parents.join(' + ')}>
            Merge · {commit.parents.map((parent) => parent.slice(0, 7)).join(' + ')}
          </span>
        )}
        <CommitChanges
          key={entry.key}
          sessionId={sessionId}
          repositoryId={repository.id}
          hash={commit.hash}
        />
      </div>
    </>
  );
}

function CommitChanges({ sessionId, repositoryId, hash }: Input<'git.historyStats'>) {
  const [stats, setStats] = useState<Results['git.historyStats'] | null>();
  useEffect(() => {
    let active = true;
    void desktop.call('git.historyStats', { sessionId, repositoryId, hash }).then(
      (changes) => {
        if (active) setStats(changes);
      },
      () => {
        if (active) setStats(null);
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, repositoryId, hash]);

  return (
    <div
      className="ms-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap tabular-nums"
      role="group"
      aria-label="Commit changes"
    >
      {stats === undefined ? (
        <Skeleton className="h-3 w-24" aria-label="Loading changes" />
      ) : stats ? (
        <>
          <span className="font-mono text-diff-addition-foreground">
            +{stats.insertions.toLocaleString()}
          </span>
          <span className="font-mono text-diff-deletion-foreground">
            −{stats.deletions.toLocaleString()}
          </span>
          <span className="text-muted-foreground">
            · {stats.files.toLocaleString()} {stats.files === 1 ? 'file' : 'files'}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground" title="Commit changes unavailable">
          —
        </span>
      )}
    </div>
  );
}
