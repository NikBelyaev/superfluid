import { desktop } from '~/rpc/desktop';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  repositoryConnection,
  type Session,
  type PullRequest,
  type PullRequestRef,
  type PullRequestSummary,
  type PullRequestChanges,
} from '@superfluid/contracts';
import { useApp, showSurface } from '~/state/workspaceStore';
import { PullRequestList } from './PullRequestList';
import { PullRequestDiscussion } from './PullRequestDiscussion';
import { MarkdownText as RequestMarkdown } from '~/components/ui/MarkdownText';
import {
  PullRequestDetailHeader,
  PullRequestDetailTabBar,
  PullRequestSection,
} from './PullRequestDetailLayout';
import { PullRequestComposer } from './PullRequestComposer';
import {
  PullRequestCodeSkeleton,
  PullRequestDiscussionSkeleton,
  PullRequestSkeleton,
} from './PullRequestSkeleton';
import { PullRequestInlineEdit } from './PullRequestInlineEdit';
import { RequestCI } from './RequestCI';
import { PullRequestChecks } from './PullRequestChecks';
import { useBranchRequests } from './branchRequests';
import { Skeleton } from '~/components/ui/Skeleton';

const PullRequestCode = lazy(() =>
  import('./PullRequestCode').then((module) => ({ default: module.PullRequestCode })),
);

const tabs = [
  { value: 'summary', label: 'Summary' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'code', label: 'Code' },
] as const;

export function PullRequestSurface({
  session,
  number,
  request,
  repositoryId,
  revealChecks,
}: {
  session: Session;
  number?: number;
  request?: PullRequestRef;
  repositoryId?: string;
  revealChecks?: string;
}) {
  const binding = useApp((app) => app.projects.find((project) => project.id === session.projectId));
  const repository = useApp((app) =>
    app.repositories[session.id]?.find((repository) =>
      repositoryId ? repository.id === repositoryId : !repository.path,
    ),
  );
  const connection = repositoryConnection(binding, repository?.path ?? '');
  const cached = useBranchRequests((state) => state.sessions[session.id]?.[repository?.id ?? '']);
  const summary =
    repository && cached?.identity === JSON.stringify([session.id, repository.branch, connection])
      ? cached.page?.items.find((item) =>
          request ? JSON.stringify(item.ref) === JSON.stringify(request) : item.number === number,
        )
      : undefined;
  if (!request && !number)
    return (
      <PullRequestList
        repositoryId={repositoryId}
        key={session.id + repositoryId + JSON.stringify(connection)}
        session={session}
      />
    );
  return (
    <PullRequestDetails
      repositoryId={repositoryId}
      revealChecks={revealChecks}
      key={
        session.id + repositoryId + JSON.stringify(request ?? number) + JSON.stringify(connection)
      }
      session={session}
      number={number}
      request={request}
      summary={summary}
    />
  );
}

function PullRequestDetails({
  session,
  number,
  request,
  repositoryId,
  revealChecks,
  summary,
}: {
  session: Session;
  number?: number;
  request?: PullRequestRef;
  repositoryId?: string;
  revealChecks?: string;
  summary?: PullRequestSummary;
}) {
  const [details, setPr] = useState<PullRequest | null>(null),
    [tab, setTab] = useState<'summary' | 'timeline' | 'code'>('summary'),
    [error, setError] = useState(''),
    [codeOpened, setCodeOpened] = useState(false),
    [codeRevision, setCodeRevision] = useState(0),
    [token, setToken] = useState(0);
  const pr =
    details ??
    (summary
      ? {
          ...summary,
          additions: null,
          deletions: null,
          changedFiles: null,
          statusCheckRollup: summary.statusCheckRollup ?? [],
        }
      : null);
  const [commit, setCommit] = useState<{ sha: string; title: string } | null>(null);
  const [checksReveal, setChecksReveal] = useState(0);
  const showChecks = () => {
    setTab('summary');
    setChecksReveal((value) => value + 1);
  };
  useEffect(() => {
    if (revealChecks) {
      setTab('summary');
      setChecksReveal((value) => value + 1);
    }
  }, [revealChecks]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void desktop
      .call('pr.read', { sessionId: session.id, repositoryId, ref: request, number })
      .then((value) => {
        if (!cancelled) setPr(value);
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, repositoryId, request, number, token]);
  useEffect(
    () =>
      desktop.onEvent((event) => {
        if (
          event.type === 'pr.changed' &&
          event.sessionId === session.id &&
          JSON.stringify(event.ref) === JSON.stringify(pr?.ref)
        )
          setToken((value) => value + 1);
      }),
    [session.id, pr?.ref],
  );
  const provider = pr?.ref.provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const list = () => showSurface({ kind: 'pr', repositoryId }, session.id);
  if (error && !pr)
    return (
      <div className="surface-empty">
        <h3>Request unavailable</h3>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => setToken(token + 1)}>
          Try again
        </button>
        <button className="button" onClick={list}>
          Repository requests
        </button>
      </div>
    );
  if (!pr) return <PullRequestSkeleton />;
  const updateRequest = async (changes: PullRequestChanges, expectedUpdatedAt: string) => {
    setPr(
      await desktop.call('pr.update', {
        sessionId: session.id,
        repositoryId,
        ref: pr.ref,
        expectedUpdatedAt,
        changes,
      }),
    );
  };
  return (
    <div
      className="surface-content pr-surface pr-detail relative bg-background"
      aria-busy={!details && !error}
    >
      <PullRequestDetailHeader
        request={pr}
        sessionId={session.id}
        repositoryId={repositoryId}
        revision={token}
        loading={!details && !error}
        onBack={list}
        onTitleSave={(title, version) => updateRequest({ title }, version)}
        onBaseSave={(baseRefName, version) => updateRequest({ baseRefName }, version)}
        onRefresh={() => {
          setToken((value) => value + 1);
          setCodeRevision((value) => value + 1);
        }}
        onDraftChange={(draft) => updateRequest({ draft }, pr.updatedAt)}
      />
      <PullRequestDetailTabBar
        tabs={tabs}
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          if (value === 'code') setCodeOpened(true);
        }}
        label={pr.ref.provider === 'gitlab' ? 'Merge request' : 'Pull request'}
      >
        {tab === 'summary' && (
          <span className="pr-checks-status ml-auto inline-flex items-center justify-end gap-1.5 text-xs leading-5 text-muted-foreground">
            {pr.statusCheckRollup.length || pr.checksError || (!details && error) ? (
              <RequestCI
                checks={pr.statusCheckRollup}
                error={pr.checksError ?? (!details ? error : undefined)}
                onShowAll={showChecks}
              />
            ) : !details && !error ? (
              <span role="status" aria-label="Loading checks">
                <Skeleton className="h-3 w-16" />
              </span>
            ) : (
              'No checks reported'
            )}
          </span>
        )}
      </PullRequestDetailTabBar>
      {error && (
        <p
          className="pr-detail-error m-0 bg-[var(--warning-surface)] px-4 py-2 text-xs leading-5 text-[var(--warning-foreground)]"
          role="alert"
        >
          Could not refresh this request. {error}{' '}
          <button className="text-button" onClick={() => setToken((value) => value + 1)}>
            Try again
          </button>
        </p>
      )}
      <div
        className="pr-panel [&[hidden]]:hidden"
        id="pr-panel-summary"
        role="tabpanel"
        aria-labelledby="pr-tab-summary"
        hidden={tab !== 'summary'}
      >
        <div className="pr-scroll pr-summary px-0 pt-0 pb-16">
          <PullRequestSection title="Description">
            <PullRequestInlineEdit
              value={pr.body}
              version={pr.updatedAt}
              label="Description"
              variant="description"
              onSave={(body, version) => updateRequest({ body }, version)}
            >
              <RequestMarkdown
                text={pr.body || '_No description provided._'}
                baseUrl={`https://${pr.ref.host}`}
              />
            </PullRequestInlineEdit>
          </PullRequestSection>
          <PullRequestChecks
            sessionId={session.id}
            repositoryId={repositoryId}
            request={pr}
            reveal={checksReveal}
            loading={!details && !error}
          />
          <PullRequestSection title="Comments">
            {details ? (
              <PullRequestDiscussion
                revision={token}
                sessionId={session.id}
                repositoryId={repositoryId}
                request={pr.ref}
              />
            ) : (
              <PullRequestDiscussionSkeleton />
            )}
          </PullRequestSection>
        </div>
      </div>
      <div
        className="pr-panel [&[hidden]]:hidden"
        id="pr-panel-timeline"
        role="tabpanel"
        aria-labelledby="pr-tab-timeline"
        hidden={tab !== 'timeline'}
      >
        <div className="pr-scroll pr-timeline px-4 pt-5 pb-16">
          {details ? (
            <PullRequestDiscussion
              revision={token}
              sessionId={session.id}
              repositoryId={repositoryId}
              request={pr.ref}
              timeline
              onSelectCommit={(value) => {
                setCommit(value);
                setCodeOpened(true);
                setTab('code');
              }}
            />
          ) : (
            <PullRequestDiscussionSkeleton timeline />
          )}
          <button
            className="text-button"
            onClick={() => void desktop.external(pr.url).catch(useApp.getState().fail)}
          >
            Open full timeline on {provider} <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
      <div
        className="pr-panel [&[hidden]]:hidden"
        id="pr-panel-code"
        role="tabpanel"
        aria-labelledby="pr-tab-code"
        hidden={tab !== 'code'}
      >
        {codeOpened && (
          <>
            {commit && (
              <div className="pr-commit-scope flex flex-none items-center gap-2 border-0 border-b border-solid border-border px-4 py-2 text-xs leading-5">
                <code>{commit.sha.slice(0, 8)}</code>
                <span className="flex-1 truncate" title={commit.title}>
                  {commit.title}
                </span>
                <button className="text-button flex-none" onClick={() => setCommit(null)}>
                  All changes
                </button>
              </div>
            )}
            <Suspense fallback={<PullRequestCodeSkeleton />}>
              <PullRequestCode
                key={`${pr.headRefOid}:${pr.baseRefName}:${codeRevision}:${commit?.sha ?? ''}`}
                sessionId={session.id}
                repositoryId={repositoryId}
                request={pr.ref}
                commit={commit?.sha}
              />
            </Suspense>
          </>
        )}
      </div>
      <PullRequestComposer
        sessionId={session.id}
        repositoryId={repositoryId}
        request={pr.ref}
        onCommented={() => setToken((value) => value + 1)}
      />
    </div>
  );
}
