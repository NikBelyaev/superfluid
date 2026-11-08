import { Popover } from '@base-ui/react/popover';
import { CircleCheck, CircleDashed, CircleDot, CircleX, Pause, TriangleAlert } from 'lucide-react';
import {
  pullRequestCheckState,
  summarizePullRequestChecks,
  type PullRequestCheck,
} from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';

export function CheckIcon({ check }: { check: PullRequestCheck }) {
  const state = pullRequestCheckState(check);
  const Icon =
    state === 'failed'
      ? CircleX
      : state === 'pending'
        ? CircleDot
        : state === 'blocked'
          ? Pause
          : state === 'passed'
            ? CircleCheck
            : state === 'warning'
              ? TriangleAlert
              : CircleDashed;
  const color =
    state === 'failed'
      ? 'text-[var(--error-foreground)]'
      : state === 'passed'
        ? 'text-[var(--success-foreground)]'
        : ['pending', 'blocked', 'warning'].includes(state)
          ? 'text-[var(--warning-foreground)]'
          : 'text-muted-foreground';
  return <Icon size={13} className={`pr-check-icon ${state} flex-none ${color}`} aria-hidden />;
}

export function RequestCI({
  checks = [],
  error,
  onShowAll,
}: {
  checks?: PullRequestCheck[];
  error?: string;
  onShowAll: () => void;
}) {
  if (!checks.length && !error) return null;
  const unavailable = !checks.length;
  const { state, count, total } = summarizePullRequestChecks(checks);
  const jobs = checks.filter((check) => check.kind !== 'pipeline');
  const counted = jobs.length ? jobs : checks;
  const completed = counted.filter((check) =>
    ['passed', 'warning', 'skipped'].includes(pullRequestCheckState(check)),
  ).length;
  const matching = counted.filter((check) => pullRequestCheckState(check) === state);
  const selected = matching[0] ??
    checks.find((check) => check.kind === 'pipeline') ?? {
      name: 'Checks',
      state: 'UNKNOWN',
    };
  const labels = {
    failed: 'failed',
    pending: 'pending',
    blocked: 'waiting',
    warning: 'allowed failures',
    passed: 'passed',
    skipped: 'skipped',
    unknown: 'unknown',
  };
  const title = unavailable
    ? 'Could not load checks'
    : state === 'failed'
      ? 'Some checks were not successful'
      : state === 'pending'
        ? 'Checks are in progress'
        : state === 'passed'
          ? count === total
            ? 'All checks passed'
            : 'Checks completed'
          : 'Checks';
  const aggregateOnly = !matching.length && selected.kind === 'pipeline';
  const badgeLabel = unavailable
    ? 'CI unavailable'
    : aggregateOnly
      ? `Pipeline ${selected.state.toLowerCase().replaceAll('_', ' ')}`
      : state === 'pending'
        ? `${completed}/${total} checks`
        : `${count} ${labels[state]}`;
  const preview = unavailable ? [] : matching.length ? matching.slice(0, 5) : [selected];
  return (
    <Popover.Root>
      <Popover.Trigger
        className={`pr-ci ${state} inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-sm py-0.5 text-muted-foreground [font-size:var(--text-2xs)] hover:text-foreground data-popup-open:text-foreground ${state === 'pending' || state === 'passed' ? 'bg-transparent px-0' : 'bg-muted px-[5px] hover:bg-accent data-popup-open:bg-accent'}`}
        openOnHover
        delay={250}
        closeDelay={150}
        aria-label={
          unavailable || aggregateOnly
            ? badgeLabel
            : state === 'passed'
              ? title
              : state === 'pending' && !aggregateOnly
                ? `${completed} of ${total} checks completed`
                : `${count} ${labels[state]} checks`
        }
      >
        <CheckIcon check={selected} />
        {state !== 'passed' && <span>{badgeLabel}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="pr-ci-positioner z-100"
        >
          <Popover.Popup
            className="pr-ci-popover w-[min(340px,calc(100vw-24px))] max-h-[min(480px,var(--available-height))] overflow-auto rounded-lg border border-solid border-border bg-popover p-3.5 text-foreground shadow-[var(--shadow-popover)] [font-size:var(--text-xs)]"
            initialFocus={(type) => type === 'keyboard'}
            finalFocus={false}
          >
            <Popover.Title className="m-0 mb-2 font-medium [font-size:var(--text-sm)]">
              {title}
            </Popover.Title>
            {!!total && !aggregateOnly && (
              <p className="m-0 mb-2 text-muted-foreground">
                {count} of {total} {labels[state]}
              </p>
            )}
            {preview.map((check, index) => (
              <div className="pr-ci-check flex items-center gap-2 py-1" key={check.id ?? index}>
                <CheckIcon check={check} />
                <span className="min-w-0 flex-1 truncate" title={check.name}>
                  {check.name}
                </span>
                <small className="text-muted-foreground">
                  {check.state.toLowerCase().replaceAll('_', ' ')}
                </small>
                {check.url && (
                  <button
                    className="text-button text-[var(--link-foreground,var(--primary))]"
                    onClick={() => void desktop.external(check.url!).catch(useApp.getState().fail)}
                  >
                    Details
                  </button>
                )}
              </div>
            ))}
            {error && (
              <p className="pr-ci-error m-0 mb-2 text-[var(--warning-foreground)] leading-[18px]">
                {error}
              </p>
            )}
            <Popover.Close className="text-button mt-2" onClick={onShowAll}>
              Show all
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
