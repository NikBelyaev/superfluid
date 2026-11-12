import type { GitFile, GitStatus, Operation, Session, Input } from '@superfluid/contracts';
import { HostingService } from '../hosting/HostingService';
import { git, safeRef } from './gitCommand';
import { Gate } from '../utils/Gate';

import { Store } from '../persistence/Store';
import { digest } from '../utils/digest';
import { readBranchBase, resolveBranch } from './branchBase';
import { within } from '../files/paths';
import { ProcessError } from '../process/ProcessRunner';
import { recoverOperation, remoteCommit, trackPush } from './operationRecovery';

export const unresolvedPhases = [
  'committing',
  'committed',
  'pushing',
  'pushed',
  'creating-pr',
  'uncertain',
  'needs-review',
  'switching',
  'stashing',
  'applying-stash',
];

export function parseStatus(output: string): Omit<GitStatus, 'branches' | 'repo' | 'changes'> {
  let branch = '',
    head = '',
    upstream = '',
    ahead = 0,
    behind = 0;
  const files: GitFile[] = [],
    rows = output.split('\0');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row.startsWith('# branch.head ')) branch = row.slice(14);
    else if (row.startsWith('# branch.oid ')) head = row.slice(13);
    else if (row.startsWith('# branch.upstream ')) upstream = row.slice(18);
    else if (row.startsWith('# branch.ab ')) {
      const m = row.match(/\+(\d+) -(\d+)/);
      if (m) {
        ahead = +m[1];
        behind = +m[2];
      }
    } else if (row.startsWith('? ')) files.push({ path: row.slice(2), index: '?', worktree: '?' });
    else if (/^[12u] /.test(row)) {
      const parts = row.split(' '),
        kind = parts[0];
      const path = parts.slice(kind === '1' ? 8 : kind === '2' ? 9 : 10).join(' ');
      files.push({
        path,
        index: parts[1][0],
        worktree: parts[1][1],
        ...(kind === '2' ? { original: rows[++i] } : {}),
      });
    }
  }
  return {
    branch: branch === '(detached)' ? 'Detached HEAD' : branch,
    head,
    upstream,
    ahead,
    behind,
    files,
  };
}

export class GitService {
  private reads = new Gate(2);

  private writers = new Map<string, Gate>();
  private statuses = new Map<string, Promise<GitStatus>>();
  private running = new Map<string, Promise<Operation>>();
  private reconciling = new Map<string, Promise<Operation>>();
  constructor(
    private store: Store,
    private notify: (operation: Operation) => void,
    private hosting = new HostingService(store),
  ) {}
  async status(s: Session): Promise<GitStatus> {
    const key = s.gitDir || s.id;
    const existing = this.statuses.get(key);
    if (existing) return existing;
    const work = this.reads
      .run(async () => {
        if (!s.gitDir)
          return {
            branch: '',
            head: '',
            upstream: '',
            ahead: 0,
            behind: 0,
            files: [],
            branches: [],
            repo: false,
            changes: { insertions: 0, deletions: 0 },
          };
        const [raw, branches, remotes, stash] = await Promise.all([
          git(
            s.path,
            [
              '--no-optional-locks',
              'status',
              '--porcelain=v2',
              '--branch',
              '--untracked-files=normal',
              '-z',
            ],
            {
              timeout: 5000,
            },
          ),
          git(
            s.path,
            ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/'],
            { timeout: 5000 },
          ),
          this.hosting.remotes(s),
          git(s.path, ['rev-parse', '--verify', '--quiet', 'refs/stash'], { accept: [1] }).catch(
            () => '',
          ),
        ]);
        const status = parseStatus(raw),
          changes = { insertions: 0, deletions: 0 };
        const count = (numstat: string, target = changes) => {
          for (const match of numstat.matchAll(/^(\d+)\t(\d+)\t/gm)) {
            target.insertions += Number(match[1]);
            target.deletions += Number(match[2]);
          }
        };
        if (status.files.some((file) => file.index !== '?')) {
          const base =
            status.head === '(initial)'
              ? (await git(s.path, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })).trim()
              : status.head;
          count(
            await git(
              s.path,
              ['diff', '--numstat', '--no-ext-diff', '--find-renames', base, '--'],
              { timeout: 5000 },
            ),
          );
        }
        for (const file of status.files) {
          if (file.index === '?' && !file.path.endsWith('/'))
            count(
              await git(
                s.path,
                ['diff', '--no-index', '--numstat', '--no-ext-diff', '--', '/dev/null', file.path],
                { accept: [1], timeout: 5000 },
              ),
            );
        }
        const refs = branches.trim().split('\n');
        const remote = remotes.selected;
        const comparison =
          status.upstream ||
          [
            `${remote}/${status.branch}`,
            `${remote}/HEAD`,
            `${remote}/main`,
            `${remote}/master`,
          ].find((ref) => refs.includes(ref));
        let outgoing: GitStatus['outgoing'] = comparison
          ? { insertions: 0, deletions: 0 }
          : undefined;
        if (comparison && outgoing && (status.ahead > 0 || !status.upstream)) {
          try {
            count(
              await git(
                s.path,
                ['diff', '--numstat', '--no-ext-diff', `${safeRef(comparison)}...HEAD`, '--'],
                { timeout: 5000 },
              ),
              outgoing,
            );
          } catch {
            outgoing = undefined;
          }
        }
        const baseBranch =
          status.branch && status.branch !== 'Detached HEAD'
            ? await readBranchBase(s.path, status.branch)
            : undefined;
        const head = status.head && status.head !== '(initial)';
        const pushRef = `${remote}/${status.branch}`;
        const baseRef = (
          baseBranch
            ? [`${remote}/${baseBranch}`, baseBranch]
            : [`${remote}/HEAD`, `${remote}/main`, `${remote}/master`, 'main', 'master']
        ).find((ref) => refs.includes(ref));
        const [push, prChanges] = await Promise.all([
          remote && head && status.branch !== 'Detached HEAD'
            ? status.upstream === pushRef
              ? { ahead: status.ahead, behind: status.behind }
              : refs.includes(pushRef)
                ? git(s.path, ['rev-list', '--left-right', '--count', `${safeRef(pushRef)}...HEAD`])
                    .then((counts) => {
                      const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
                      return { ahead, behind };
                    })
                    .catch(() => undefined)
                : { ahead: 1, behind: 0 }
            : undefined,
          (baseRef?.startsWith(`${remote}/`)
            ? baseRef.slice(String(remote).length + 1)
            : baseRef) === status.branch
            ? false
            : head && baseRef
              ? git(s.path, [
                  'diff',
                  '--name-only',
                  '--no-ext-diff',
                  `${safeRef(baseRef)}...HEAD`,
                  '--',
                ])
                  .then((files) => !!files)
                  .catch(() => undefined)
              : head
                ? undefined
                : false,
        ]);
        return {
          ...status,
          baseBranch,
          hasRemote: !!remote,
          remote: remote ?? undefined,
          push,
          prChanges,
          stash: stash.trim() || undefined,
          files: status.files,
          changes,
          outgoing,
          branches: branches.trim().split('\n').filter(Boolean).slice(0, 1000),
          repo: true,
        };
      })
      .finally(() => {
        if (this.statuses.get(key) === work) this.statuses.delete(key);
      });
    this.statuses.set(key, work);
    return work;
  }
  async index(s: Session, path: string) {
    if (!s.gitDir) return null;
    return this.reads.run(async () => {
      const entry = await git(s.path, [
        '--literal-pathspecs',
        'ls-files',
        '--stage',
        '-z',
        '--',
        path,
      ]);
      if (!entry) {
        const ignored = await git(s.path, ['check-ignore', '--quiet', '--', path]).then(
          () => true,
          (error: unknown) => {
            if (error instanceof ProcessError && error.code === 1) return false;
            throw error;
          },
        );
        return ignored ? null : '';
      }
      const staged = entry.match(/^(\d+) ([0-9a-f]+) 0\t/);
      if (!staged)
        throw new Error('Resolve Git conflicts before comparing this file with the index.');
      if (!/^100/.test(staged[1])) return null;
      const text = await git(s.path, ['cat-file', 'blob', staged[2]]);
      return text.includes('\0') ? null : text;
    });
  }
  async diff(s: Session, path: string | undefined, mode: string, base: string) {
    return this.reads.run(async () => {
      if (mode === 'branch') safeRef(base);
      if (path && mode === 'unstaged') {
        const tracked = await git(s.path, ['ls-files', '--error-unmatch', '--', path], {
          accept: [1],
        });
        if (!tracked.trim()) {
          if (path.endsWith('/'))
            throw new Error(
              'Untracked directory. Open individual files from the project tree to review changes.',
            );
          return git(
            s.path,
            ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', path],
            { accept: [1] },
          );
        }
      }
      const args = [
        'diff',
        '--no-ext-diff',
        '--no-color',
        '--find-renames',
        ...(mode === 'staged' ? ['--cached'] : mode === 'branch' ? [`${base}...HEAD`] : []),
        '--',
        ...(path ? [path] : []),
      ];
      return git(s.path, args, { timeout: 15000 });
    });
  }
  act(s: Session, input: Input<'git.act'>): Promise<Operation> {
    const existing = this.running.get(input.operationId);
    if (existing) return existing;
    // Worktrees have separate Git directories but share refs and stashes.
    const run = git(s.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      .then((directory) => {
        const key = directory.trim();
        const gate = this.writers.get(key) ?? new Gate(1);
        this.writers.set(key, gate);
        return gate.run(() => this.perform(s, input));
      })
      .finally(() => {
        this.running.delete(input.operationId);
        this.statuses.delete(s.gitDir || s.id);
      });
    this.running.set(input.operationId, run);
    return run;
  }
  async recover(s: Session, repositoryId?: string) {
    for (const operation of this.store.all<Operation>('operations')) {
      if (
        operation.sessionId === s.id &&
        operation.repositoryId === repositoryId &&
        unresolvedPhases.includes(operation.phase) &&
        !this.running.has(operation.id)
      )
        await this.reconcile(s, operation);
    }
  }
  private reconcile(s: Session, operation: Operation) {
    const pending = this.reconciling.get(operation.id);
    if (pending) return pending;
    const work = recoverOperation(s, operation, this.hosting)
      .catch(() => operation)
      .then((result) => {
        if (result !== operation) {
          this.store.put('operations', result);
          this.notify(result);
        }
        return result;
      })
      .finally(() => this.reconciling.delete(operation.id));
    this.reconciling.set(operation.id, work);
    return work;
  }
  private async perform(s: Session, input: Input<'git.act'>): Promise<Operation> {
    await this.recover(s, input.repositoryId);
    const unresolved = this.store
      .all<Operation>('operations')
      .find(
        (o) =>
          o.sessionId === s.id &&
          o.repositoryId === input.repositoryId &&
          o.id !== input.operationId &&
          unresolvedPhases.includes(o.phase),
      );
    if (unresolved)
      throw new Error(
        'We couldn’t confirm how your last Git action finished. Review the result to continue.',
      );
    let op = this.store.get<Operation>('operations', input.operationId);
    if (op && (op.sessionId !== s.id || op.repositoryId !== input.repositoryId))
      throw new Error('This operation belongs to another worktree or repository.');
    const intent = digest(JSON.stringify({ ...input, operationId: undefined }));
    if (op?.evidence.intent && op.evidence.intent !== intent)
      throw new Error('This operation ID already belongs to another request.');
    if (op && unresolvedPhases.includes(op.phase)) op = await this.reconcile(s, op);
    if (op?.phase === 'completed' || op?.evidence.rolledBack) return op;
    if (op?.phase === 'reviewed')
      throw new Error('This attempt was reviewed. Start a new operation.');
    if (op && unresolvedPhases.includes(op.phase))
      throw new Error(
        'The previous result is uncertain. Inspect the Git log or remote before starting another publication.',
      );
    op ??= {
      id: input.operationId,
      sessionId: s.id,
      repositoryId: input.repositoryId,
      phase: 'preparing',
      evidence: {},
    };
    const operation = op;
    operation.evidence.intent = intent;
    operation.evidence.action = input.action;
    const update = (phase: string) => {
      operation.phase = phase;
      delete operation.error;
      delete operation.evidence.pendingPhase;
      this.store.put('operations', operation);
      this.notify(operation);
    };
    try {
      if (input.action === 'stash' || input.action === 'stash-apply') {
        const files = parseStatus(
          await git(s.path, ['status', '--porcelain=v2', '--untracked-files=all', '-z']),
        ).files.filter((file) => file.index !== '?' || !file.path.endsWith('/'));
        operation.evidence.stashAction = input.action;
        operation.evidence.initial = (
          await git(s.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { accept: [1] })
        ).trim();
        operation.evidence.originalBranch = (
          await git(s.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { accept: [1] })
        ).trim();
        if (input.action === 'stash') {
          if (await git(s.path, ['ls-files', '--unmerged', '-z']))
            throw new Error('Resolve merge conflicts before stashing.');
          if (!files.length) {
            operation.evidence.skipped = true;
            update('completed');
            return operation;
          }
          if (
            !(
              await git(s.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { accept: [1] })
            ).trim()
          )
            throw new Error('Make the first commit before stashing.');
          operation.evidence.stashBefore = (
            await git(s.path, ['rev-parse', '--verify', '--quiet', 'refs/stash'], { accept: [1] })
          ).trim();
          update('stashing');
          await git(s.path, [
            'stash',
            'push',
            '--include-untracked',
            '--message',
            `superfluid:${operation.id}`,
          ]);
          operation.evidence.stash = (
            await git(s.path, ['rev-parse', '--verify', 'refs/stash'])
          ).trim();
          if (operation.evidence.stash === operation.evidence.stashBefore)
            throw new Error('Git did not create a new stash. Inspect the stash list.');
        } else {
          if (files.length)
            throw new Error('Commit or stash local changes before applying a stash.');
          const stash =
            input.stash ||
            (
              await git(s.path, ['rev-parse', '--verify', '--quiet', 'refs/stash'], { accept: [1] })
            ).trim();
          if (!/^[0-9a-f]{40,64}$/.test(stash)) throw new Error('No stash is available.');
          await git(s.path, ['rev-parse', '--verify', `${stash}^{commit}`]);
          operation.evidence.stash = stash;
          update('applying-stash');
          await git(s.path, ['stash', 'apply', '--index', stash]);
        }
        update('completed');
        return operation;
      }
      if (input.action === 'create-branch' || input.action === 'checkout') {
        safeRef(input.branch!);
        await git(s.path, ['check-ref-format', '--branch', input.branch!]);
        if (await git(s.path, ['ls-files', '--unmerged', '-z']))
          throw new Error('Resolve merge conflicts before switching branches.');
        if (input.action === 'create-branch') safeRef(input.base || 'HEAD');
        const baseBranch =
          input.action === 'create-branch'
            ? await resolveBranch(s.path, input.base || 'HEAD')
            : undefined;
        const originalBranch = (
          await git(s.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { accept: [1] })
        ).trim();
        const initial = (await git(s.path, ['rev-parse', 'HEAD'])).trim();
        Object.assign(operation.evidence, {
          branch: input.branch,
          baseBranch,
          originalBranch,
          initial,
        });
        let stash = '';
        const files = parseStatus(
          await git(s.path, ['status', '--porcelain=v2', '--untracked-files=all', '-z']),
        ).files.filter((file) => file.index !== '?' || !file.path.endsWith('/'));
        operation.evidence.worktreeClean = !files.length;
        operation.evidence.targetHead = (
          await git(
            s.path,
            [
              'rev-parse',
              '--verify',
              '--quiet',
              `${input.action === 'create-branch' ? input.base || 'HEAD' : input.branch}^{commit}`,
            ],
            { accept: [1] },
          )
        ).trim();
        if (files.length) {
          operation.evidence.stashAction = input.action;
          const before = (
            await git(s.path, ['rev-parse', '--verify', '--quiet', 'refs/stash'], { accept: [1] })
          ).trim();
          update('stashing');
          await git(s.path, [
            'stash',
            'push',
            '--include-untracked',
            '--message',
            `superfluid:${operation.id}`,
          ]);
          stash = (await git(s.path, ['rev-parse', '--verify', 'refs/stash'])).trim();
          if (stash === before)
            throw new Error('Git did not save local changes. Inspect the stash list.');
          operation.evidence.autoStash = stash;
        }
        update('switching');
        let switched = false;
        try {
          try {
            await git(
              s.path,
              input.action === 'create-branch'
                ? ['switch', '-c', input.branch!, input.base || 'HEAD']
                : ['switch', '--', input.branch!],
            );
          } catch (error) {
            if (
              input.branch === originalBranch ||
              !operation.evidence.targetHead ||
              (await git(s.path, ['branch', '--show-current'])).trim() !== input.branch ||
              (await git(s.path, ['rev-parse', 'HEAD'])).trim() !== operation.evidence.targetHead
            )
              throw error;
            operation.evidence.warning = `Switched to “${input.branch}”, but a Git hook reported an error.`;
          }
          switched = true;
        } finally {
          if (stash) {
            const targetHead = (await git(s.path, ['rev-parse', 'HEAD'])).trim();
            const targetBranch = (
              await git(s.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { accept: [1] })
            ).trim();
            update('applying-stash');
            try {
              await git(s.path, ['stash', 'apply', '--index', stash]);
            } catch {
              if (
                (targetBranch !== input.branch && targetBranch !== originalBranch) ||
                (await git(s.path, ['rev-parse', 'HEAD'])).trim() !== targetHead ||
                (
                  await git(s.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { accept: [1] })
                ).trim() !== targetBranch ||
                (originalBranch &&
                  (await git(s.path, ['rev-parse', `refs/heads/${originalBranch}`])).trim() !==
                    initial)
              )
                throw new Error('Git changed during checkout. Automatic rollback stopped.');
              update('switching');
              await git(s.path, ['reset', '--hard', targetHead]);
              const untrackedTree = (
                await git(s.path, ['rev-parse', '--verify', '--quiet', `${stash}^3`], {
                  accept: [1],
                })
              ).trim();
              const untracked = untrackedTree
                ? (await git(s.path, ['ls-tree', '-rz', '--name-only', untrackedTree]))
                    .split('\0')
                    .filter(Boolean)
                : [];
              // Remove only untracked files backed up by this stash, never other loose files.
              if (untracked.length)
                await git(s.path, ['--literal-pathspecs', 'clean', '-fx', '--', ...untracked]);
              await git(
                s.path,
                originalBranch ? ['switch', '--', originalBranch] : ['switch', '--detach', initial],
              );
              if ((await git(s.path, ['rev-parse', 'HEAD'])).trim() !== initial)
                throw new Error('The original branch changed during rollback.');
              await git(s.path, ['stash', 'apply', '--index', stash]);
              operation.evidence.rolledBack = true;
              operation.evidence.changesRestored = true;
              if (
                input.action === 'create-branch' &&
                switched &&
                (await git(s.path, ['rev-parse', `refs/heads/${input.branch}`])).trim() ===
                  targetHead
              )
                await git(s.path, ['branch', '-D', '--', input.branch!]);
            }
            operation.evidence.changesRestored = true;
            // Drop only this operation's stash; other worktrees share the stash list.
            const entry = (await git(s.path, ['stash', 'list', '--format=%H %gd']))
              .split('\n')
              .find((line) => line.startsWith(`${stash} `));
            if (entry) await git(s.path, ['stash', 'drop', entry.split(' ')[1]]);
            if (operation.evidence.rolledBack)
              throw new Error(
                `Your changes conflict with this branch. Returned to ${originalBranch ? `“${originalBranch}”` : 'the original commit'} and restored your changes.`,
              );
          }
        }
        if ((await git(s.path, ['branch', '--show-current'])).trim() !== input.branch)
          throw new Error('The branch changed during checkout. Inspect the repository.');
        if (baseBranch)
          await git(s.path, [
            'config',
            '--local',
            `branch.${input.branch}.gh-merge-base`,
            baseBranch,
          ]);
        operation.commit = (await git(s.path, ['rev-parse', 'HEAD'])).trim();
        update('completed');
        return operation;
      }
      const branch = (await git(s.path, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
      if (!branch.startsWith('refs/heads/'))
        throw new Error('Create or select a named branch before publishing.');
      if (input.branch && branch !== `refs/heads/${safeRef(input.branch)}`)
        throw new Error('The current branch changed. Reopen the Git action to review compare.');
      const initial = (
        await git(s.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { accept: [1] })
      ).trim();
      const hosted = input.action === 'pr' || input.action === 'publish';
      const target = hosted ? await this.hosting.resolve(s, input.targetProject) : undefined;
      if (target && input.hostingRevision && target.revision !== input.hostingRevision)
        throw new Error('The hosting target changed. Reopen the publication dialog.');
      const provider = target ? this.hosting.provider(target) : undefined;
      let base = '';
      if (target && provider) {
        const defaultBranch = target.defaultBranch || (await provider.defaultBranch(target));
        base = input.base || defaultBranch;
        safeRef(base);
        await this.hosting.assertCurrent(s, target);
      }
      let remote = target?.remoteUrl ?? '';
      if (input.action !== 'commit' && !target) {
        const { selected } = await this.hosting.remotes(s);
        if (!selected) throw new Error('Choose a Git remote before pushing this branch.');
        remote = (await git(s.path, ['remote', 'get-url', '--push', selected])).trim();
      }
      if (remote.startsWith('-'))
        throw new Error('The origin remote is not a valid publication target.');
      if (/^https?:\/\//.test(remote)) {
        const url = new URL(remote);
        if (url.username || url.password)
          throw new Error('Use a Git credential helper instead of credentials in the origin URL.');
      }
      const before = operation.evidence;
      if (before.hosting && before.hosting !== target?.revision)
        throw new Error(
          'The hosting target changed. Review the previous publication before continuing.',
        );
      if (before.branch && (before.branch !== branch || before.remote !== remote))
        throw new Error('The branch or remote changed. Review the target before continuing.');
      Object.assign(before, {
        branch,
        remote,
        initial: before.initial ?? initial,
        destination: branch,
        ...(target ? { hosting: target.revision, targetProject: target.targetProject, base } : {}),
      });
      update('preparing');
      if (!operation.commit && (input.action === 'commit' || input.action === 'publish')) {
        if (input.action === 'commit' && !input.message?.trim())
          throw new Error('Enter a commit message.');
        if (input.paths?.some((p) => !p || p.startsWith('/') || p.split('/').includes('..')))
          throw new Error('Choose paths inside this worktree.');
        let paths = input.paths || [];
        if (input.allChanges) {
          if (await git(s.path, ['ls-files', '--unmerged', '-z']))
            throw new Error('Resolve merge conflicts before committing.');
          paths = parseStatus(
            await git(s.path, ['status', '--porcelain=v2', '--untracked-files=all', '-z']),
          )
            .files.filter(
              (file) => file.worktree !== '.' && (file.index !== '?' || !file.path.endsWith('/')),
            )
            .map((file) => file.path);
          for (const path of paths) await within(s.path, path, true);
        }
        if (paths.length && !input.message?.trim()) throw new Error('Enter a commit message.');
        if (paths.length) await git(s.path, ['add', '--', ...paths]);
        const tree = (await git(s.path, ['write-tree'])).trim();
        const unchanged =
          initial && tree === (await git(s.path, ['rev-parse', `${initial}^{tree}`])).trim();
        if (unchanged && input.action === 'commit') {
          operation.evidence.skipped = true;
          update('completed');
          return operation;
        }
        if (!unchanged) {
          if (!input.message?.trim()) throw new Error('Enter a commit message.');
          if (
            (
              await git(s.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { accept: [1] })
            ).trim() !== initial ||
            (await git(s.path, ['symbolic-ref', 'HEAD'])).trim() !== branch
          )
            throw new Error('HEAD changed during preparation. Review the Git state.');
          Object.assign(before, { tree, parent: initial });
          update('committing');
          await git(s.path, ['commit', '-m', input.message!], {
            timeout: 120000,
            env: { GIT_REFLOG_ACTION: `superfluid:${operation.id}` },
          });
          const oid = (await git(s.path, ['rev-parse', 'HEAD'])).trim();
          const actual = (await git(s.path, ['show', '-s', '--format=%T%n%P', oid]))
            .trim()
            .split('\n');
          if (
            actual[0] !== tree ||
            (actual[1] ?? '') !== initial ||
            (await git(s.path, ['symbolic-ref', 'HEAD'])).trim() !== branch
          ) {
            before.observedCommit = oid;
            update('needs-review');
            throw new Error(
              'The commit result differs from the approved tree or parent. It was not pushed. Inspect the Git log.',
            );
          }
          operation.commit = oid;
          update('committed');
        }
      }
      if (input.action === 'commit') {
        update('completed');
        return operation;
      }
      operation.commit ??= initial;
      if (!operation.commit)
        throw new Error('Make the first commit before pushing or creating a pull request.');
      if (input.action === 'push' || input.action === 'publish') {
        if (
          (await git(s.path, ['symbolic-ref', 'HEAD'])).trim() !== branch ||
          (await git(s.path, ['rev-parse', 'HEAD'])).trim() !== operation.commit
        )
          throw new Error('The active branch or commit changed. Publication stopped.');
        before.remoteBefore = await this.hosting.network.run(() =>
          remoteCommit(s.path, remote, branch),
        );
        delete before.pushRejected;
        update('pushing');
        try {
          await this.hosting.network.run(() =>
            git(s.path, ['push', '--porcelain', '--', remote, `${operation.commit}:${branch}`], {
              timeout: 120000,
              env: { LC_ALL: 'C' },
            }),
          );
        } catch (error) {
          before.pushRejected =
            error instanceof ProcessError &&
            error.stdout.split('\n').some((line) => {
              const [flag, ref, status] = line.split('\t');
              return (
                flag === '!' &&
                ref?.endsWith(`:${branch}`) &&
                /^\[(?:remote )?rejected\]/.test(status || '')
              );
            });
          throw error;
        }
        const actual = (await git(s.path, ['ls-remote', '--', remote, branch]))
          .trim()
          .split(/\s/)[0];
        if (actual !== operation.commit) {
          update('needs-review');
          throw new Error('The remote branch moved. Inspect it before creating the pull request.');
        }
        before.remoteCommit = actual;
        await trackPush(s, remote, branch, operation.commit, this.hosting);
        update('pushed');
      }
      if (input.action === 'push') {
        update('completed');
        return operation;
      }
      if (!target || !provider) throw new Error('A hosting target is required.');
      await this.hosting.assertCurrent(s, target);
      const head = branch.slice('refs/heads/'.length);
      if (
        (await git(s.path, ['ls-remote', '--', remote, branch])).trim().split(/\s/)[0] !==
        operation.commit
      )
        throw new Error('Push this commit before creating its request.');
      const found = await provider.list(target, { state: 'open', page: 1, branch: head, base });
      if (found.items.length > 1 || found.hasMore)
        throw new Error('Multiple matching requests. Choose one from the repository list.');
      let actual;
      if (found.items.length === 1) {
        actual = await provider.read(target, found.items[0].number);
      } else {
        await this.hosting.assertCurrent(s, target);
        if ((await git(s.path, ['rev-parse', 'HEAD'])).trim() !== operation.commit)
          throw new Error('HEAD changed. Publication stopped.');
        update('creating-pr');
        const title =
          input.title?.trim() ||
          input.message?.trim().split('\n')[0] ||
          (await git(s.path, ['show', '-s', '--format=%s', operation.commit])).trim();
        const created = await provider.create(target, {
          head,
          base,
          title,
          body: input.body || '',
          draft: input.draft !== false,
        });
        operation.url = created.url;
        operation.pullRequest = created.ref;
        this.store.put('operations', operation);
        actual = await provider.read(target, created.ref.number);
      }
      operation.url = actual.url;
      operation.pullRequest = actual.ref;
      if (actual.headRefOid !== operation.commit) {
        update('needs-review');
        throw new Error('The request points to a different commit. Review it on the server.');
      }
      update('completed');
      return operation;
    } catch (error: any) {
      operation.error = error.message || 'Git operation failed.';
      if (operation.evidence.autoStash && !operation.evidence.changesRestored)
        operation.error += ` Local changes are saved in stash ${operation.evidence.autoStash}. Inspect the current branch and resolve conflicts before restoring with git stash apply --index ${operation.evidence.autoStash}.`;
      operation.evidence.pendingPhase = operation.phase;
      operation.phase = operation.evidence.rolledBack
        ? 'failed'
        : [
              'committing',
              'pushing',
              'creating-pr',
              'switching',
              'stashing',
              'applying-stash',
            ].includes(operation.phase)
          ? 'uncertain'
          : operation.phase === 'needs-review'
            ? 'needs-review'
            : 'failed';
      this.store.put('operations', operation);
      if (operation.phase === 'uncertain') {
        const result = await this.reconcile(s, operation);
        if (result !== operation) return result;
      }
      this.notify(operation);
      return operation;
    }
  }
  async inspect(s: Session, id: string) {
    const operation = this.store.get<Operation>('operations', id);
    if (!operation || operation.sessionId !== s.id) throw new Error('Git operation not found.');
    let log = await git(s.path, ['log', '-8', '--oneline', '--decorate', '--all']).catch(
      (e: Error) => e.message,
    );
    if (operation.evidence.stashAction || operation.evidence.autoStash)
      log += '\nStashes:\n' + (await git(s.path, ['stash', 'list', '--format=%H %gs', '-8']));
    const branch = String(operation.evidence.branch ?? '');
    const target = String(operation.evidence.remote ?? '');
    const remote =
      branch && target
        ? await git(s.path, ['ls-remote', '--', target, branch], { timeout: 15000 }).catch(
            (e: Error) => e.message,
          )
        : '';
    return { operation, log, remote };
  }
  acknowledge(s: Session, id: string) {
    if (this.running.has(id))
      throw new Error('This operation is still running. Wait for its result.');
    const operation = this.store.get<Operation>('operations', id);
    if (!operation || operation.sessionId !== s.id) throw new Error('Git operation not found.');
    if (!unresolvedPhases.includes(operation.phase)) return operation;
    operation.evidence.reviewedAt = Date.now();
    operation.evidence.previousPhase = operation.phase;
    operation.phase = 'reviewed';
    this.store.put('operations', operation);
    this.notify(operation);
    return operation;
  }
}
