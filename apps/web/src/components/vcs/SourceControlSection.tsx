import { desktop } from '~/rpc/desktop';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Archive,
  ArchiveRestore,
  ChevronDown,
  CircleAlert,
  CloudUpload,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
} from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import type { Session } from '@superfluid/contracts';
import { showSurface, useApp } from '~/state/workspaceStore';
import { openRepositoryMenu, runGitBatch } from '~/commands/gitBatch';
import {
  gitActionProblem,
  hasRepositoryChanges,
  repositoriesForAction,
  selectedRepositories,
} from '~/state/repositories';
import { RepositoryMenu } from './RepositoryMenu';
import { DiffStat } from './DiffStat';
import { GitProviderIcon } from './GitProviderIcon';

const uncertain = [
  'committing',
  'committed',
  'pushing',
  'pushed',
  'creating-pr',
  'switching',
  'stashing',
  'applying-stash',
  'uncertain',
  'needs-review',
];

function Elapsed({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <span className="repository-elapsed" aria-hidden>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

export function SourceControlSection({ session }: { session: Session }) {
  const status = useApp((s) => s.git[session.id]);
  const batch = useApp((s) => s.gitBatches[session.id]);
  const operations = useApp((s) => s.operations);
  const repositoryIds = useApp((s) => s.views[session.id]?.repositoryIds);
  const repositories = useApp((s) => s.repositories[session.id]);
  const statuses = useApp((s) => s.repositoryGit[session.id]);
  const selected = selectedRepositories(repositories || [], repositoryIds);
  const committing = hasRepositoryChanges(selected, statuses);
  const sessionOperations = operations.filter((op) => op.sessionId === session.id);
  const problems = {
    commit: gitActionProblem('commit', selected, statuses, sessionOperations),
    push: gitActionProblem('push', selected, statuses, sessionOperations),
    pr: gitActionProblem('pr', selected, statuses, sessionOperations),
    publish: gitActionProblem('publish', selected, statuses, sessionOperations),
    stash: gitActionProblem('stash', selected, statuses, sessionOperations),
    'stash-apply': gitActionProblem('stash-apply', selected, statuses, sessionOperations),
  };
  const needsPr = repositoriesForAction('pr', selected, statuses).length > 0;
  const primaryAction = committing
    ? problems.publish && !problems.commit
      ? 'commit'
      : 'publish'
    : !problems.push
      ? needsPr
        ? 'publish'
        : 'push'
      : !problems.pr
        ? 'pr'
        : 'publish';
  const primaryLabel =
    primaryAction === 'commit'
      ? 'Commit'
      : committing
        ? 'Commit, push & PR'
        : primaryAction === 'push'
          ? 'Push'
          : primaryAction === 'pr'
            ? 'Create PR'
            : 'Push & PR';
  const providers = new Set(selected.map((r) => r.provider));
  const provider = providers.size === 1 ? selected[0]?.provider : undefined;
  const actionAnchor = useRef<HTMLDivElement>(null);
  const worktree = useApp((s) => s.repositoryWorktrees[session.id]);
  const running = batch?.phase === 'running' || !!worktree;
  const failures = batch?.entries.filter((e) => e.error) || [];
  const unresolved = operations.find(
    (o) =>
      o.sessionId === session.id &&
      uncertain.includes(o.phase) &&
      repositoryIds?.includes(o.repositoryId || repositories?.find((r) => !r.path)?.id || ''),
  );
  const review =
    failures
      .map((e) => operations.find((o) => o.id === e.request.operationId) || e.result)
      .find((o) => o && uncertain.includes(o.phase)) ||
    (!batch && unresolved);
  const action =
    batch &&
    {
      'create-branch': 'Branch',
      checkout: 'Checkout',
      commit: 'Commit',
      push: 'Push',
      pr: 'PR',
      publish: 'Publish',
      stash: 'Stash',
      'stash-apply': 'Apply stash',
    }[batch.action];
  const label = worktree
    ? 'Creating worktree…'
    : review
      ? 'Inspect Git result…'
      : !batch
        ? primaryLabel
        : running
          ? `${action}…`
          : batch.phase === 'completed'
            ? batch.entries.every((e) => e.result?.evidence.skipped)
              ? 'No changes'
              : `${action} completed`
            : `${action} · Retry`;
  const title = batch?.entries
    .map(
      (e) =>
        `${repositories?.find((r) => r.id === e.request.repositoryId)?.path || 'Root'}: ${e.error || e.result?.phase || 'pending'}`,
    )
    .join('\n');
  return (
    <div className="island-section">
      {repositories?.length ? (
        <RepositoryMenu session={session} />
      ) : (
        <button
          className="island-row"
          disabled={!repositories}
          onClick={() =>
            void desktop
              .call('git.init', { sessionId: session.id })
              .then(() => useApp.getState().refreshRepositories(session.id, true))
              .catch(useApp.getState().fail)
          }
        >
          <GitBranch size={14} />
          <span>{repositories ? 'Initialize Git' : 'Finding repositories…'}</span>
        </button>
      )}
      <div className="split-action" ref={actionAnchor}>
        <button
          className={`island-row repository-operation ${batch?.phase || ''}`}
          title={title || problems[primaryAction] || undefined}
          aria-live="polite"
          aria-busy={running}
          disabled={running || (!review && !failures.length && !!problems[primaryAction])}
          onClick={() => {
            if (review) useApp.setState({ modal: { kind: 'git-review', id: review.id } });
            else if (failures.length) {
              const reviewed = failures.some(
                (e) => operations.find((o) => o.id === e.request.operationId)?.phase === 'reviewed',
              );
              if (reviewed) openRepositoryMenu(session.id, batch!.action);
              else
                void runGitBatch(
                  session.id,
                  batch!.action,
                  failures.map((e) => e.request),
                ).catch(useApp.getState().fail);
            } else openRepositoryMenu(session.id, primaryAction);
          }}
        >
          {running ? (
            <LoaderCircle size={14} className="repository-spinner" />
          ) : review || failures.length ? (
            <CircleAlert size={14} />
          ) : batch?.phase === 'completed' ? (
            <Check size={14} />
          ) : (
            <GitProviderIcon provider={provider} />
          )}
          <span className="repository-operation-label">{label}</span>
          {batch && !worktree && (
            <span className="repository-operation-count">
              {running ? batch.done : batch.entries.length - failures.length}/{batch.entries.length}
            </span>
          )}
        </button>
        <Menu.Root>
          <Menu.Trigger
            className="split-menu-trigger"
            aria-label="Individual Git actions"
            disabled={running || !repositoryIds?.length}
          >
            {running ? (
              <Elapsed
                key={worktree?.startedAt || batch?.id}
                startedAt={worktree?.startedAt || batch!.startedAt}
              />
            ) : (
              <ChevronDown size={16} />
            )}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              anchor={actionAnchor}
              className="menu-positioner repository-actions-positioner"
              align="end"
              sideOffset={4}
            >
              <Menu.Popup className="small-menu repository-actions-menu">
                {(['commit', 'push', 'pr'] as const).map((action) => (
                  <Menu.Item
                    key={action}
                    disabled={!!problems[action]}
                    title={problems[action] || undefined}
                    onClick={() => openRepositoryMenu(session.id, action)}
                  >
                    {action === 'commit' ? (
                      <GitCommitHorizontal size={16} aria-hidden />
                    ) : action === 'push' ? (
                      <CloudUpload size={16} aria-hidden />
                    ) : (
                      <GitProviderIcon provider={provider} size={16} />
                    )}
                    {action === 'pr' ? 'Create PR' : action === 'commit' ? 'Commit' : 'Push'}
                  </Menu.Item>
                ))}
                <Menu.Separator className="repository-actions-separator" />
                {(['stash', 'stash-apply'] as const).map((action) => (
                  <Menu.Item
                    key={action}
                    disabled={!!problems[action]}
                    title={problems[action] || undefined}
                    onClick={() => openRepositoryMenu(session.id, action)}
                  >
                    {action === 'stash' ? (
                      <Archive size={16} aria-hidden />
                    ) : (
                      <ArchiveRestore size={16} aria-hidden />
                    )}
                    {action === 'stash' ? 'Stash' : 'Apply stash'}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <button className="island-row" onClick={() => showSurface({ kind: 'diff' }, session.id)}>
        <FileDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>Changes</span>
        <DiffStat changes={status?.changes} />
      </button>
    </div>
  );
}
