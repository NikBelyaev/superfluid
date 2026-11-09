import { useEffect, useState } from 'react';
import { ArrowRightLeft, GitBranch, LoaderCircle, Plus } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { createRepositoryWorktree, runGitBatch } from '~/commands/gitBatch';
import { selectedRepositories, repositoryBranch } from '~/state/repositories';
import { useApp } from '~/state/workspaceStore';
import { RepositoryBranchPicker, RepositoryCreationPicker } from './RepositoryBranchPicker';
import { RepositoryNotice } from './RepositoryNotice';

export function RepositoryGraph({
  session,
  initialAction,
  onComplete,
}: {
  session: Session;
  initialAction?: 'create-branch' | 'checkout';
  onComplete: () => void;
}) {
  const repositories = useApp((s) => s.repositories[session.id]) || [];
  const ids = useApp((s) => s.views[session.id]?.repositoryIds) || [];
  const statuses = useApp((s) => s.repositoryGit[session.id]);
  const errors = useApp((s) => s.repositoryErrors[session.id]);
  const batch = useApp((s) => s.gitBatches[session.id]);
  const creatingWorktree = useApp((s) => s.repositoryWorktrees[session.id]);
  const group = selectedRepositories(repositories, ids);
  const [action, setAction] = useState<'create-branch' | 'checkout' | null>(initialAction || null);
  const [base, setBase] = useState(''),
    [branch, setBranch] = useState(''),
    [destination, setDestination] = useState('');
  const [worktree, setWorktree] = useState(false),
    [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(''),
    [seconds, setSeconds] = useState(0);
  const current = [...new Set(group.map((r) => statuses?.[r.id]?.branch || r.branch))];
  const source =
    base ||
    (current.length === 1 && !['Detached HEAD', 'Git unavailable'].includes(current[0])
      ? current[0]
      : 'HEAD');
  const branches = [...new Set(group.flatMap((r) => statuses?.[r.id]?.branches || []))].sort();
  const target = repositoryBranch(statuses?.[group[0]?.id], destination);
  const name = (path: string) => path || session.path.split('/').at(-1) || 'root';
  const missingTarget = group
    .filter(
      (r) =>
        !statuses?.[r.id]?.branches.some(
          (b) => b === target || b === `${statuses?.[r.id]?.remote || 'origin'}/${target}`,
        ),
    )
    .map((r) => name(r.path));
  const missingSource = group
    .filter((r) => !statuses?.[r.id]?.branches.includes(source))
    .map((r) => name(r.path));
  const invalidName =
    !branch.trim() ||
    /\s|\.\.|\/\/|@\{|[~^:?*\[\\]/.test(branch) ||
    branch.startsWith('-') ||
    branch
      .split('/')
      .some(
        (part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'),
      );
  const branchExists = group.some((r) => statuses?.[r.id]?.branches.includes(branch.trim()));
  const problem = !action
    ? ''
    : !group.length
      ? 'Choose repositories first.'
      : group.some((r) => errors?.[r.id])
        ? 'Refresh unavailable Git status before continuing.'
        : group.some((r) => !statuses?.[r.id])
          ? 'Loading Git status…'
          : action === 'create-branch' && invalidName
            ? 'Enter a valid new branch name.'
            : action === 'create-branch' && branchExists
              ? 'This branch already exists in a selected repository.'
              : action === 'create-branch' && source !== 'HEAD' && missingSource.length
                ? `Source branch “${source}” is missing in ${missingSource.join(', ')}.`
                : action === 'checkout' && !destination
                  ? 'Choose a branch to switch to.'
                  : action === 'checkout' && missingTarget.length
                    ? `Branch “${destination}” is missing in ${missingTarget.join(', ')}.`
                    : action === 'checkout' && group.every((r) => r.branch === target)
                      ? 'Already on this branch.'
                      : '';
  const running = pending || !!creatingWorktree || batch?.phase === 'running';
  const edit = () => {
    setFailure('');
  };
  const selectExistingBranch = (value: string) => {
    setDestination(value);
    setBranch('');
    setAction('checkout');
    edit();
  };
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const submit = async () => {
    if (!action || problem || running) return;
    setPending(true);
    setSeconds(0);
    setFailure('');
    try {
      if (action === 'create-branch' && worktree) {
        await createRepositoryWorktree(
          session,
          group.map((r) => r.id),
          branch.trim(),
          source,
        );
      } else {
        await runGitBatch(
          session.id,
          action,
          group
            .filter((r) => action !== 'checkout' || r.branch !== target)
            .map((r) => ({
              sessionId: session.id,
              repositoryId: r.id,
              operationId: crypto.randomUUID(),
              action,
              branch: action === 'create-branch' ? branch.trim() : target,
              base: source,
            })),
        );
        const failed = useApp.getState().gitBatches[session.id]?.entries.find((e) => e.error);
        if (failed?.error) throw new Error(failed.error);
      }
      onComplete();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      className="repository-graph-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={running} className="repository-graph-fields">
        <legend className="text-caption m-0 mb-1 p-0">Select branch</legend>
        <div className="repository-graph" data-selected={action || undefined}>
          <div className="repository-graph-top">
            <RepositoryBranchPicker
              value={source}
              branches={['HEAD', ...branches]}
              label="Source branch"
              onChange={(v) => {
                setBase(v);
                edit();
              }}
            />
            <ArrowRightLeft size={14} className="repository-switch-icon" aria-hidden />
            <div className="repository-switch-target">
              <RepositoryBranchPicker
                value={destination}
                branches={branches}
                label="Switch branch"
                placeholder="Switch to…"
                onOpen={() => {
                  setBranch('');
                  setAction(destination ? 'checkout' : null);
                  edit();
                }}
                onChange={selectExistingBranch}
              />
            </div>
          </div>
          <div className="repository-graph-plot">
            <svg viewBox="0 0 300 88" preserveAspectRatio="none" aria-hidden="true">
              <path className="repository-straight-line" d="M10 8H300" />
              <path className="repository-new-line" d="M10 8C58 8 57 72 128 72H300" />
              <path className="repository-line-hit repository-straight-hit" d="M10 8H300" />
              <circle cx="10" cy="8" r="3.5" />
            </svg>
            <div className="repository-new-target">
              <RepositoryCreationPicker
                value={branch}
                onChange={(v) => {
                  setBranch(v);
                  if (v.trim()) setDestination('');
                  setAction(v.trim() ? 'create-branch' : null);
                  edit();
                }}
                worktree={worktree}
                onModeChange={(v) => {
                  setWorktree(v);
                  setDestination('');
                  setAction('create-branch');
                  edit();
                }}
              />
            </div>
          </div>
        </div>
        {(failure || (action && problem)) && (
          <RepositoryNotice tone={failure ? 'error' : 'warning'}>
            {failure || problem}
            {!failure && action === 'create-branch' && branchExists && !invalidName && (
              <button
                type="button"
                className="repository-graph-switch"
                onClick={() => selectExistingBranch(branch.trim())}
              >
                Switch
              </button>
            )}
          </RepositoryNotice>
        )}
        {action && !problem && !failure && !(action === 'create-branch' && worktree) && (
          <RepositoryNotice tone="info">
            Your uncommitted changes will move with you to the selected branch.
          </RepositoryNotice>
        )}
        <button
          className="button primary repository-graph-submit"
          disabled={!action || !!problem || running}
          aria-live="polite"
          aria-busy={running}
        >
          {running ? (
            <LoaderCircle size={14} className="repository-spinner" />
          ) : action === 'create-branch' ? (
            <Plus size={14} />
          ) : (
            <GitBranch size={14} />
          )}
          <span>
            {running
              ? action === 'checkout'
                ? 'Switching…'
                : 'Creating…'
              : !action
                ? 'Choose an action'
                : action === 'checkout'
                  ? `Switch · ${group.filter((r) => r.branch !== target).length}`
                  : `${worktree ? 'Create worktree' : 'Create & switch'} · ${group.length}`}
          </span>
          {pending && (
            <small>
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </small>
          )}
        </button>
      </fieldset>
    </form>
  );
}
