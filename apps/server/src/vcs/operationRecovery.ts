import type { Operation, Session } from '@superfluid/contracts';
import type { HostingService } from '../hosting/HostingService';
import { git } from './gitCommand';

export async function remoteCommit(path: string, remote: string, branch: string) {
  return (await git(path, ['ls-remote', '--', remote, branch])).trim().split(/\s/)[0];
}

export async function trackPush(
  session: Session,
  remote: string,
  branch: string,
  commit: string,
  hosting: HostingService,
) {
  const { selected } = await hosting.remotes(session);
  if (
    !selected ||
    (await git(session.path, ['remote', 'get-url', '--push', selected])).trim() !== remote
  )
    return;
  const name = branch.slice('refs/heads/'.length);
  // Pushing a pinned OID does not update branch tracking.
  await git(session.path, ['update-ref', `refs/remotes/${selected}/${name}`, commit]);
  if (
    !(await git(session.path, ['config', '--get', `branch.${name}.remote`], { accept: [1] })).trim()
  )
    await git(session.path, ['branch', `--set-upstream-to=${selected}/${name}`, '--', name]);
}

export async function recoverOperation(
  session: Session,
  operation: Operation,
  hosting: HostingService,
): Promise<Operation> {
  const evidence = operation.evidence;
  const phase = typeof evidence.pendingPhase === 'string' ? evidence.pendingPhase : operation.phase;
  const action = evidence.action ?? evidence.stashAction;
  const finish = (phase: 'failed' | 'completed', error = operation.error) => ({
    ...operation,
    phase,
    error: phase === 'completed' ? undefined : error || 'The Git action did not finish. Try again.',
  });
  if (operation.phase === 'needs-review') return operation;
  if (phase === 'creating-pr' && operation.commit && typeof evidence.hosting === 'string') {
    if (typeof evidence.branch !== 'string' || typeof evidence.base !== 'string') return operation;
    const target = await hosting.resolve(
      session,
      typeof evidence.targetProject === 'string' ? evidence.targetProject : undefined,
    );
    if (target.revision !== evidence.hosting) return operation;
    const provider = hosting.provider(target);
    let ref = operation.pullRequest;
    if (!ref) {
      const found = await provider.list(target, {
        state: 'open',
        page: 1,
        branch: evidence.branch.replace(/^refs\/heads\//, ''),
        base: evidence.base,
      });
      if (found.items.length !== 1 || found.hasMore) return operation;
      ref = found.items[0].ref;
    }
    hosting.assertRef(target, ref);
    const request = await provider.read(target, ref.number);
    if (request.headRefOid !== operation.commit) return { ...operation, phase: 'needs-review' };
    return { ...finish('completed'), url: request.url, pullRequest: request.ref };
  }
  if (phase === 'pushing' && operation.commit) {
    if (evidence.pushRejected) return finish('failed');
    const remote = evidence.remote;
    const ref = evidence.branch;
    if (typeof remote !== 'string' || typeof ref !== 'string') return operation;
    const actual = await hosting.network.run(() => remoteCommit(session.path, remote, ref));
    if (actual === operation.commit) {
      const warning = await trackPush(session, remote, ref, actual, hosting)
        .then(() => undefined)
        .catch(() => 'Your commit was pushed, but branch tracking could not be updated.');
      return {
        ...finish(
          action === 'push' ? 'completed' : 'failed',
          'Your commit was pushed. Try again to finish creating the pull request.',
        ),
        evidence: { ...evidence, remoteCommit: actual, ...(warning ? { warning } : {}) },
      };
    }
    if (typeof evidence.remoteBefore === 'string' && actual === evidence.remoteBefore)
      return finish('failed');
    return { ...operation, phase: 'needs-review' };
  }
  if ((phase === 'committed' || phase === 'pushed') && operation.commit)
    return finish(
      (phase === 'committed' && action === 'commit') || (phase === 'pushed' && action === 'push')
        ? 'completed'
        : 'failed',
      'The Git action stopped before all steps finished. Try again.',
    );
  if (!['committing', 'switching', 'applying-stash', 'stashing'].includes(phase)) return operation;
  const head = (
    await git(session.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { accept: [1] })
  ).trim();
  const branch = (
    await git(session.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { accept: [1] })
  ).trim();
  if (phase === 'committing') {
    if (`refs/heads/${branch}` !== evidence.branch) return operation;
    if (head === evidence.parent) return finish('failed');
    if (!head) return operation;
    const [tree, parent = ''] = (await git(session.path, ['show', '-s', '--format=%T%n%P', head]))
      .trim()
      .split('\n');
    if (tree !== evidence.tree || parent !== evidence.parent)
      return { ...operation, phase: 'needs-review' };
    return {
      ...finish(
        action === 'commit' ? 'completed' : 'failed',
        'Your commit was created. Try again to finish publishing it.',
      ),
      commit: head,
    };
  }
  const dirty = (
    await git(session.path, ['status', '--porcelain=v2', '--untracked-files=all', '-z'])
  )
    .split('\0')
    .some((entry) => entry && !(entry.startsWith('? ') && entry.endsWith('/')));
  if (action === 'stash-apply') {
    if (head !== evidence.initial || branch !== evidence.originalBranch) return operation;
    if (await git(session.path, ['ls-files', '--unmerged', '-z']))
      return {
        ...finish(
          'failed',
          'Resolve the stash conflicts before continuing. Your stash is still saved.',
        ),
        evidence: { ...evidence, conflicts: true },
      };
    if (!dirty) return finish('failed');
    return operation;
  }
  if (action === 'checkout' || action === 'create-branch') {
    if (evidence.autoStash && !evidence.changesRestored) return operation;
    if (!evidence.changesRestored && (!evidence.worktreeClean || dirty)) return operation;
    if (branch === evidence.originalBranch && head === evidence.initial) {
      if (action === 'checkout' && typeof evidence.branch === 'string') {
        const available = await git(session.path, [
          'for-each-ref',
          '--format=%(refname)',
          `refs/heads/${evidence.branch}`,
          `refs/remotes/*/${evidence.branch}`,
        ]);
        if (!available.trim())
          return finish(
            'failed',
            `Branch “${evidence.branch}” is no longer available. ${branch ? `You’re still on “${branch}”` : 'You’re still at the original commit'}, and your changes are safe. Reopen the branch list and choose another branch.`,
          );
      }
      return finish('failed');
    }
    if (branch === evidence.branch && head === evidence.targetHead) {
      if (action === 'create-branch' && typeof evidence.baseBranch === 'string')
        await git(session.path, [
          'config',
          '--local',
          `branch.${branch}.gh-merge-base`,
          evidence.baseBranch,
        ]);
      return finish('completed');
    }
  }
  if (
    action === 'stash' &&
    !dirty &&
    head === evidence.initial &&
    branch === evidence.originalBranch
  ) {
    const stash = (await git(session.path, ['stash', 'list', '--format=%H %gs']))
      .split('\n')
      .find((line) => line.endsWith(`superfluid:${operation.id}`))
      ?.split(' ')[0];
    if (stash) return { ...finish('completed'), evidence: { ...evidence, stash } };
  }
  return operation;
}
