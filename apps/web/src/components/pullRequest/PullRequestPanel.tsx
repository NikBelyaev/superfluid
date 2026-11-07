import { desktop } from '~/rpc/desktop';
import { useEffect, useState } from 'react';
import { ArrowUpRight, CircleDot, Pencil } from 'lucide-react';
import {
  repositoryConnection,
  type Session,
  type PullRequest,
  type PullRequestRef,
} from '@superfluid/contracts';
import { useApp, showSurface } from '~/state/workspaceStore';
import { Patch } from '~/components/diffs/Patch';
import { PullRequestList } from './PullRequestList';
import { PullRequestDiscussion, RequestMarkdown } from './PullRequestDiscussion';
import {
  PullRequestDetailHeader,
  PullRequestDetailTabBar,
  PullRequestSection,
  PullRequestChecks,
} from './PullRequestDetailLayout';
import { PullRequestComposer } from './PullRequestComposer';
import './pullRequest.css';

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
}: {
  session: Session;
  number?: number;
  request?: PullRequestRef;
  repositoryId?: string;
}) {
  const binding = useApp((app) => app.projects.find((project) => project.id === session.projectId));
  const path =
    useApp(
      (app) =>
        app.repositories[session.id]?.find((repository) => repository.id === repositoryId)?.path,
    ) ?? '';
  const connection = repositoryConnection(binding, path);
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
      key={
        session.id + repositoryId + JSON.stringify(request ?? number) + JSON.stringify(connection)
      }
      session={session}
      number={number}
      request={request}
    />
  );
}

function PullRequestDetails({
  session,
  number,
  request,
  repositoryId,
}: {
  session: Session;
  number?: number;
  request?: PullRequestRef;
  repositoryId?: string;
}) {
  const [pr, setPr] = useState<PullRequest | null>(null),
    [tab, setTab] = useState<'summary' | 'timeline' | 'code'>('summary'),
    [error, setError] = useState(''),
    [patch, setPatch] = useState<string | null>(null),
    [patchError, setPatchError] = useState(''),
    [token, setToken] = useState(0);
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
  useEffect(() => {
    let cancelled = false;
    setPatch(null);
    setPatchError('');
    if (tab === 'code' && pr)
      void desktop
        .call('pr.patch', { sessionId: session.id, repositoryId, ref: pr.ref })
        .then((value) => {
          if (!cancelled) setPatch(value);
        })
        .catch((error: Error) => {
          if (!cancelled) setPatchError(error.message);
        });
    return () => {
      cancelled = true;
    };
  }, [session.id, repositoryId, tab, pr, token]);
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
  if (!pr)
    return (
      <div className="surface-empty" role="status">
        Loading request…
      </div>
    );
  return (
    <div className="surface-content pr-surface pr-detail">
      <PullRequestDetailHeader
        request={pr}
        onBack={list}
        onRefresh={() => setToken((value) => value + 1)}
        onEdit={() =>
          useApp.setState({
            modal: { kind: 'pr-edit', sessionId: session.id, repositoryId, request: pr },
          })
        }
      />
      <PullRequestDetailTabBar
        tabs={tabs}
        value={tab}
        onValueChange={setTab}
        label={pr.ref.provider === 'gitlab' ? 'Merge request' : 'Pull request'}
      >
        {tab === 'summary' && (
          <span className="pr-checks-status">
            <CircleDot size={14} aria-hidden />
            {pr.statusCheckRollup.length
              ? `Checks · ${pr.statusCheckRollup.length}`
              : 'No checks reported'}
          </span>
        )}
      </PullRequestDetailTabBar>
      {error && (
        <p className="pr-detail-error" role="alert">
          Could not refresh this request. {error}{' '}
          <button className="text-button" onClick={() => setToken((value) => value + 1)}>
            Try again
          </button>
        </p>
      )}
      <div className="pr-panel" id="pr-panel" role="tabpanel" aria-labelledby={`pr-tab-${tab}`}>
        {tab === 'summary' && (
          <div className="pr-scroll pr-summary">
            <PullRequestSection title="Description">
              <div className="pr-description">
                <div className="markdown">
                  <RequestMarkdown text={pr.body || '_No description provided._'} />
                </div>
                <button
                  className="icon-button"
                  title="Edit description"
                  aria-label="Edit description"
                  onClick={() =>
                    useApp.setState({
                      modal: { kind: 'pr-edit', sessionId: session.id, repositoryId, request: pr },
                    })
                  }
                >
                  <Pencil size={14} />
                </button>
              </div>
            </PullRequestSection>
            <PullRequestChecks checks={pr.statusCheckRollup} />
            <PullRequestSection title="Comments">
              <PullRequestDiscussion
                revision={token}
                sessionId={session.id}
                repositoryId={repositoryId}
                request={pr.ref}
              />
            </PullRequestSection>
          </div>
        )}
        {tab === 'timeline' && (
          <div className="pr-scroll pr-timeline">
            <PullRequestDiscussion
              revision={token}
              sessionId={session.id}
              repositoryId={repositoryId}
              request={pr.ref}
              timeline
            />
            <button
              className="text-button"
              onClick={() => void desktop.external(pr.url).catch(useApp.getState().fail)}
            >
              Open full timeline on {provider} <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        {tab === 'code' &&
          (patchError ? (
            <div className="surface-empty" role="alert">
              {patchError}
              <button className="button" onClick={() => setToken(token + 1)}>
                Try again
              </button>
            </div>
          ) : patch === null ? (
            <div className="surface-empty" role="status">
              Loading diff…
            </div>
          ) : patch ? (
            <Patch patch={patch} />
          ) : (
            <div className="surface-empty">No diff available.</div>
          ))}
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
