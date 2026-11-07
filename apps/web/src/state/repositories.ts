import type { GitRepository, GitStatus, Input, Operation } from '@superfluid/contracts';

type Action = Exclude<Input<'git.act'>['action'], 'create-branch' | 'checkout'>;

const hasHead = (status: GitStatus) => !!status.head && status.head !== '(initial)';
const named = (status: GitStatus) =>
  !!status.branch && !['Detached HEAD', 'Git unavailable'].includes(status.branch);

export function repositoryBranch(status: GitStatus | undefined, ref: string) {
  const prefix = `${status?.remote || 'origin'}/`;
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

export function repositoriesForAction(
  action: Action,
  repositories: GitRepository[],
  statuses: Record<string, GitStatus> = {},
) {
  return repositories.filter((repository) => {
    const status = statuses[repository.id];
    if (!status) return false;
    const dirty = status.files.length > 0;
    const pr =
      hasHead(status) &&
      status.prChanges !== false &&
      status.branches.some(
        (branch) =>
          branch !== `${status.remote || 'origin'}/HEAD` &&
          repositoryBranch(status, branch) !== status.branch,
      );
    switch (action) {
      case 'commit':
      case 'stash':
        return dirty;
      case 'push':
        return (status.push?.ahead || 0) > 0;
      case 'pr':
        return pr;
      case 'publish':
        return dirty || (status.push?.ahead || 0) > 0 || pr;
      case 'stash-apply':
        return !!status.stash;
    }
  });
}

export function gitActionProblem(
  action: Action,
  repositories: GitRepository[],
  statuses: Record<string, GitStatus> = {},
  operations: Operation[] = [],
) {
  if (!repositories.length) return 'Choose repositories first.';
  if (repositories.some((r) => !statuses[r.id])) return 'Loading Git status…';
  if (
    operations.some(
      (op) =>
        !['completed', 'failed', 'reviewed', 'preparing'].includes(op.phase) &&
        repositories.some((r) => op.repositoryId === r.id || (!r.path && !op.repositoryId)),
    )
  )
    return 'Inspect the previous Git operation before continuing.';
  const values = repositories.map((r) => statuses[r.id]);
  const targets = repositoriesForAction(action, repositories, statuses);
  const dirty = values.some((status) => status.files.length > 0);
  if (action === 'stash-apply') {
    if (!targets.length) return 'No stash is available.';
    if (dirty) return 'Commit or stash local changes before applying a stash.';
    if (targets.some((r) => !hasHead(statuses[r.id])))
      return 'Make the first commit before applying a stash.';
    return '';
  }
  if (action === 'commit' || action === 'stash') {
    if (!targets.length)
      return action === 'stash' ? 'No changes to stash.' : 'No changes to commit.';
    if (action === 'stash') {
      if (
        values.some((status) =>
          status.files.some(
            (file) =>
              file.index === 'U' ||
              file.worktree === 'U' ||
              (file.index === file.worktree && ['A', 'D'].includes(file.index)),
          ),
        )
      )
        return 'Resolve merge conflicts before stashing.';
      return targets.some((r) => !hasHead(statuses[r.id]))
        ? 'Make the first commit before stashing.'
        : '';
    }
    return targets.some((r) => !named(statuses[r.id]))
      ? 'Create or select a named branch first.'
      : '';
  }
  if ((action === 'push' || action === 'pr') && dirty)
    return `Commit or stash local changes before ${action === 'push' ? 'pushing' : 'creating a pull request'}.`;
  if (values.some((status) => (status.push?.behind || 0) > 0))
    return 'Pull or rebase upstream changes first.';
  if (action === 'pr' && values.some((status) => (status.push?.ahead || 0) > 0))
    return 'Push local commits before creating a pull request.';
  if (!targets.length) {
    if (action === 'push') return 'No local commits to push.';
    if (action === 'pr') return 'No new commits to include in a pull request.';
    return 'No changes, unpushed commits or pull requests to create.';
  }
  if (targets.some((r) => !statuses[r.id].hasRemote)) return 'Choose a Git remote first.';
  if (targets.some((r) => !named(statuses[r.id]))) return 'Create or select a named branch first.';
  return '';
}

export function selectedRepositories(repositories: GitRepository[], ids: string[] = []) {
  return ids.flatMap((id) => {
    const repository = repositories.find((r) => r.id === id);
    return repository ? [repository] : [];
  });
}

export function hasRepositoryChanges(
  repositories: GitRepository[],
  statuses: Record<string, GitStatus> = {},
) {
  return repositories.some((r) => !statuses[r.id] || statuses[r.id].files.length > 0);
}

export function canUseRepositoryBase(status: GitStatus | undefined, base: string) {
  const target = repositoryBranch(status, base);
  return (
    !!target &&
    !!status &&
    target !== status.branch &&
    status.branches.some(
      (branch) => branch === target || branch === `${status.remote || 'origin'}/${target}`,
    )
  );
}

export function repositorySummary(
  repositories: GitRepository[],
  statuses: Record<string, GitStatus>,
  ids: string[],
): GitStatus {
  const selected = selectedRepositories(repositories, ids);
  const primary = selected[0] && statuses[selected[0].id];
  return {
    branch: primary?.branch || selected[0]?.branch || '',
    head: primary?.head || '',
    upstream: primary?.upstream || '',
    ahead: selected.reduce((n, r) => n + (statuses[r.id]?.ahead || 0), 0),
    behind: selected.reduce((n, r) => n + (statuses[r.id]?.behind || 0), 0),
    files: selected.flatMap((r) =>
      (statuses[r.id]?.files || []).map((f) => ({
        ...f,
        path: r.path ? `${r.path}/${f.path}` : f.path,
      })),
    ),
    branches: primary?.branches || [],
    repo: repositories.length > 0,
    changes: {
      insertions: selected.reduce((n, r) => n + (statuses[r.id]?.changes.insertions || 0), 0),
      deletions: selected.reduce((n, r) => n + (statuses[r.id]?.changes.deletions || 0), 0),
    },
  };
}
