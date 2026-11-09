import { useState } from 'react';
import { ArrowLeft, ArrowUp, LoaderCircle } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import {
  canUseRepositoryBase,
  hasRepositoryChanges,
  selectedRepositories,
  gitActionProblem,
  repositoriesForAction,
  repositoryBranch,
} from '~/state/repositories';
import { runGitBatch, type GitAction } from '~/commands/gitBatch';
import { RepositoryBranchPicker } from './RepositoryBranchPicker';
import { RepositoryNotice } from './RepositoryNotice';

type Action = Exclude<GitAction, 'create-branch' | 'checkout' | 'stash' | 'stash-apply'>;

const actionNames: Record<Action, string> = {
  commit: 'Commit selected',
  push: 'Push selected',
  pr: 'Create PR',
  publish: 'Commit, push & PR',
};

export function GitActionForm({
  session,
  action,
  onClose,
}: {
  session: Session;
  action: Action;
  onClose: () => void;
}) {
  const repositories = useApp((s) => s.repositories[session.id]);
  const statuses = useApp((s) => s.repositoryGit[session.id]);
  const ids = useApp((s) => s.views[session.id]?.repositoryIds);
  const group = selectedRepositories(repositories || [], ids);
  const operations = useApp((s) => s.operations).filter((op) => op.sessionId === session.id);
  const chosen = repositoriesForAction(action, group, statuses);
  const actionProblem = gitActionProblem(action, group, statuses, operations);
  const [message, setMessage] = useState('');
  const [base, setBase] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const committing =
    action === 'commit' || (action === 'publish' && hasRepositoryChanges(group, statuses));
  const actionName = action === 'publish' && !committing ? 'Push & PR' : actionNames[action];
  const pr = action === 'pr' || action === 'publish';
  const prGroup = pr
    ? chosen.filter(
        (r) =>
          action !== 'publish' ||
          statuses?.[r.id]?.files.length ||
          repositoriesForAction('pr', [r], statuses).length,
      )
    : [];
  const baseFor = (id: string) =>
    repositoryBranch(statuses?.[id], base || statuses?.[id]?.baseBranch || '');
  const bases = [...new Set(prGroup.map((r) => baseFor(r.id)))];
  const compare = [...new Set(prGroup.map((r) => statuses?.[r.id]?.branch || r.branch))];
  const branches = [...new Set(prGroup.flatMap((r) => statuses?.[r.id]?.branches || []))].sort();
  const invalidBases = prGroup.filter(
    (r) => !canUseRepositoryBase(statuses?.[r.id], baseFor(r.id)),
  );
  const baseProblem = !pr
    ? ''
    : group.some((r) => !statuses?.[r.id])
      ? 'Loading Git status…'
      : invalidBases.length
        ? `Choose a base branch other than the current branch for ${invalidBases.map((r) => r.path || session.path.split('/').at(-1)).join(', ')}.`
        : '';
  const feedback = error ? (
    <RepositoryNotice tone="error">{error}</RepositoryNotice>
  ) : !committing && baseProblem ? (
    <RepositoryNotice tone="warning">{baseProblem}</RepositoryNotice>
  ) : null;
  const send = (
    <button
      type="submit"
      className="repository-composer-send"
      aria-label={actionName}
      aria-busy={pending}
      title={
        actionProblem ||
        baseProblem ||
        `${actionName} · ${group.map((r) => r.path || session.path.split('/').at(-1)).join(', ')}`
      }
      disabled={pending || !!actionProblem || !!baseProblem || (committing && !message.trim())}
    >
      {pending ? <LoaderCircle size={16} className="repository-spinner" /> : <ArrowUp size={16} />}
    </button>
  );
  return (
    <form
      className={`repository-form${committing ? '' : ' repository-branch-form'}`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || actionProblem) return;
        setError('');
        if (baseProblem) return;
        setPending(true);
        try {
          await runGitBatch(
            session.id,
            action,
            chosen.map((repository) => ({
              sessionId: session.id,
              repositoryId: repository.id,
              operationId: crypto.randomUUID(),
              action: action === 'publish' && !prGroup.includes(repository) ? 'push' : action,
              base: pr ? baseFor(repository.id) : undefined,
              branch: pr ? statuses?.[repository.id]?.branch || repository.branch : undefined,
              message: committing ? message : '',
              draft: false,
              allChanges: committing,
            })),
            onClose,
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setPending(false);
        }
      }}
    >
      {committing && (
        <div className="repository-composer">
          <textarea
            aria-label="Commit message"
            placeholder="Commit message…"
            autoFocus
            required
            rows={3}
            disabled={pending}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {feedback}
          <div className="repository-composer-tools">{send}</div>
        </div>
      )}
      {pr && (
        <div
          className="repository-comparison"
          title={group
            .map(
              (r) =>
                `${r.path || session.path.split('/').at(-1)}: ${baseFor(r.id) || '?'} ← ${statuses?.[r.id]?.branch || r.branch}`,
            )
            .join('\n')}
        >
          <RepositoryBranchPicker
            value={bases.length === 1 ? bases[0] : ''}
            branches={branches}
            label="Base branch"
            prefix="base:"
            placeholder={bases.length > 1 ? 'Per repository' : 'Choose base…'}
            onChange={setBase}
          />
          <ArrowLeft size={14} className="muted" aria-hidden />
          <div
            className="repository-compare-control"
            aria-label="Compare branch"
            title={group
              .map(
                (r) =>
                  `${r.path || session.path.split('/').at(-1)}: ${statuses?.[r.id]?.branch || r.branch}`,
              )
              .join('\n')}
          >
            <span className="repository-compare-value">{compare[0] || '—'}</span>
            {compare.length > 1 && (
              <span className="repository-extra-branches">+{compare.length - 1}</span>
            )}
          </div>
          {!committing && (
            <>
              {send}
              {feedback}
            </>
          )}
        </div>
      )}
      {!committing && !pr && (
        <div className="repository-direct-action">
          {feedback}
          {send}
        </div>
      )}
    </form>
  );
}
