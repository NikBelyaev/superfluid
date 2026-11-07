import type { GitStatus } from '@superfluid/contracts';

export function DiffStat({ changes }: { changes?: GitStatus['changes'] }) {
  if (!changes)
    return (
      <span className="text-muted-foreground" aria-label="Diff statistics unavailable">
        —
      </span>
    );
  if (!changes.insertions && !changes.deletions)
    return <span className="ml-auto shrink-0 text-xs text-muted-foreground">No changes</span>;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs leading-5 font-normal whitespace-nowrap tabular-nums">
      <span className="text-diff-addition-foreground">
        +{changes.insertions.toLocaleString('en-US')}
      </span>
      <span className="text-diff-deletion-foreground">
        -{changes.deletions.toLocaleString('en-US')}
      </span>
    </span>
  );
}
