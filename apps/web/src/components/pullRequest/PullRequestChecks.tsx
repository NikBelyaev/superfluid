import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, RefreshCw } from 'lucide-react';
import type { PullRequest, PullRequestCheck, PullRequestJobLog } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import { Skeleton } from '~/components/ui/Skeleton';
import { CheckIcon } from './RequestCI';

function JobLog({
  sessionId,
  repositoryId,
  request,
  check,
}: {
  sessionId: string;
  repositoryId?: string;
  request: PullRequest['ref'];
  check: PullRequestCheck;
}) {
  const [log, setLog] = useState<PullRequestJobLog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const { provider, host, project, number } = request;
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError('');
    void desktop
      .call('pr.jobLog', {
        sessionId,
        repositoryId,
        ref: { provider, host, project, number },
        jobId: check.id!,
      })
      .then((value) => {
        if (!cancelled) setLog(value);
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    repositoryId,
    provider,
    host,
    project,
    number,
    check.id,
    check.state,
    check.completedAt,
    revision,
  ]);
  return (
    <div
      className="pr-job-output border-0 border-t border-solid border-border p-2"
      aria-busy={busy}
    >
      <div className="pr-job-output-toolbar flex items-center justify-between text-muted-foreground text-[length:var(--text-2xs)]">
        <span>Output</span>
        <button
          className="icon-button"
          disabled={busy}
          aria-label={`Refresh ${check.name} output`}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {error && (
        <p className="text-[var(--warning-foreground)]" role="alert">
          {error}
        </p>
      )}
      {!log && busy && (
        <div role="status" aria-label="Loading job output">
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      )}
      {log && (
        <>
          {log.truncated && (
            <p className="muted">Showing the last 256 KiB. Open the job for the full output.</p>
          )}
          <pre
            className="mt-1.5 mb-0 max-h-90 overflow-auto rounded-sm bg-muted p-2.5 text-foreground [font-family:var(--font-mono)] text-[length:var(--text-2xs)] leading-[18px] [tab-size:4]"
            tabIndex={0}
            aria-label={`${check.name} output`}
          >
            {log.text || 'No output yet.'}
          </pre>
        </>
      )}
    </div>
  );
}

function Job({
  check,
  sessionId,
  repositoryId,
  request,
}: {
  check: PullRequestCheck;
  sessionId: string;
  repositoryId?: string;
  request: PullRequest['ref'];
}) {
  const [opened, setOpened] = useState(false);
  const duration =
    check.duration ??
    (check.startedAt && check.completedAt
      ? (Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000
      : null);
  return (
    <details
      className="pr-job group/job my-2 rounded-md border border-solid border-border"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-2.5 [&::-webkit-details-marker]:hidden">
        <CheckIcon check={check} />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{check.name}</span>
        <small className="whitespace-nowrap text-muted-foreground tabular-nums">
          {check.state.toLowerCase().replaceAll('_', ' ')}
        </small>
        {duration !== null && (
          <small className="whitespace-nowrap text-muted-foreground tabular-nums">
            {Math.round(duration)}s
          </small>
        )}
        <ChevronDown size={13} className="-rotate-90 group-open/job:rotate-0" aria-hidden />
      </summary>
      <div className="pr-job-meta flex flex-wrap items-center gap-2 px-2.5 pb-2.5 text-muted-foreground text-[length:var(--text-2xs)]">
        {check.startedAt && (
          <time dateTime={check.startedAt} title={new Date(check.startedAt).toLocaleString()}>
            {new Date(check.startedAt).toLocaleTimeString()}
            {check.completedAt ? ` → ${new Date(check.completedAt).toLocaleTimeString()}` : ''}
          </time>
        )}
        {check.allowFailure && <span>Allowed to fail</span>}
        {check.url && (
          <button
            className="text-button ml-auto"
            onClick={() => void desktop.external(check.url!).catch(useApp.getState().fail)}
          >
            Open job <ExternalLink size={12} />
          </button>
        )}
      </div>
      {check.id && opened ? (
        <JobLog sessionId={sessionId} repositoryId={repositoryId} request={request} check={check} />
      ) : (
        !check.id && <p className="muted px-2.5 pb-2.5">Output is available on the provider.</p>
      )}
    </details>
  );
}

export function PullRequestChecks({
  sessionId,
  repositoryId,
  request,
  reveal,
  loading = false,
}: {
  sessionId: string;
  repositoryId?: string;
  request: PullRequest;
  reveal: number;
  loading?: boolean;
}) {
  const section = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (reveal && section.current) {
      section.current.open = true;
      section.current.scrollIntoView({ block: 'nearest' });
    }
  }, [reveal]);
  const stages = new Map<string, PullRequestCheck[]>();
  for (const check of request.statusCheckRollup) {
    const stage = check.stage ?? 'Checks';
    const jobs = stages.get(stage) ?? [];
    jobs.push(check);
    stages.set(stage, jobs);
  }
  return (
    <details
      className="pr-section pr-jobs group/section border-0 border-b border-solid border-border/60"
      ref={section}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-xs leading-5 font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown size={14} className="-rotate-90 group-open/section:rotate-0" aria-hidden />
        <span>Checks</span>
      </summary>
      <div className="pr-section-body px-4 pb-4 text-xs leading-5">
        {request.checksError && (
          <p className="pr-ci-error text-[var(--warning-foreground)]" role="alert">
            {request.checksError}
          </p>
        )}
        {!request.statusCheckRollup.length &&
          (loading ? (
            <div role="status" aria-label="Loading checks">
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : (
            <p className="muted">No jobs reported.</p>
          ))}
        {[...stages].map(([stage, checks]) => (
          <section className="pr-job-stage [&+section]:mt-4" key={stage} aria-label={stage}>
            <h3 className="m-0 mb-2 text-muted-foreground text-[length:var(--text-2xs)] font-medium uppercase tracking-[0.04em]">
              {stage}
            </h3>
            <div className="pr-job-timeline border-0 border-l border-solid border-border pl-3">
              {checks.map((check, index) => (
                <Job
                  key={check.id ?? index}
                  check={check}
                  sessionId={sessionId}
                  repositoryId={repositoryId}
                  request={request.ref}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
