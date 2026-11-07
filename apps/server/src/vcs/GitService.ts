import type { GitFile, GitStatus, Operation, Session, Input } from '@superfluid/contracts';
import { command } from '../process/ProcessRunner';
import { git, safeRef } from './gitCommand';
import { Gate } from '../utils/Gate';

import { Store } from '../persistence/Store';
import { digest } from '../utils/digest';
import { readBranchBase, resolveBranch } from './branchBase';
import { within } from '../files/paths';

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

function hostingRepo(remote: string) {
  const scp = remote.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp) return `${scp[1]}/${scp[2].replace(/\.git$/, '')}`;
  try {
    const url = new URL(remote);
    return `${url.hostname}/${url.pathname.replace(/^\//, '').replace(/\.git$/, '')}`;
  } catch {
    return remote;
  }
}

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
  private network = new Gate(2);
  private writers = new Map<string, Gate>();
  private statuses = new Map<string, Promise<GitStatus>>();
  private running = new Map<string, Promise<Operation>>();
  constructor(
    private store: Store,
    private notify: (operation: Operation) => void,
  ) {}
  async github(s: Session, args: string[], input?: string, remote?: string) {
    const target = remote ?? (await git(s.path, ['remote', 'get-url', '--push', 'origin'])).trim();
    return this.network.run(() =>
      command('gh', [...args, '--repo', hostingRepo(target)], {
        cwd: s.path,
        input,
        timeout: 30000,
      }),
    );
  }
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
        const [raw, branches, remote, stash] = await Promise.all([
          git(
            s.path,
            [
              '--no-optional-locks',
              'status',
              '--porcelain=v2',
              '--branch',
              '--untracked-files=all',
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
          git(s.path, ['remote', 'get-url', '--push', 'origin']).catch(() => ''),
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
        const comparison =
          status.upstream ||
          [`origin/${status.branch}`, 'origin/HEAD', 'origin/main', 'origin/master'].find((ref) =>
            refs.includes(ref),
          );
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
        const pushRef = `origin/${status.branch}`;
        const baseRef = (
          baseBranch
            ? [`origin/${baseBranch}`, baseBranch]
            : ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']
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
          baseRef?.replace(/^origin\//, '') === status.branch
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
          hasRemote: !!remote.trim(),
          push,
          prChanges,
          stash: stash.trim() || undefined,
          files: status.files.filter((file) => file.index !== '?' || !file.path.endsWith('/')),
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
  async diff(s: Session, path: string | undefined, mode: string, base: string) {
    return this.reads.run(async () => {
      if (mode === 'branch') safeRef(base);
      if (path && mode === 'unstaged') {
        const tracked = await git(s.path, ['ls-files', '--error-unmatch', '--', path], {
          accept: [1],
        });
        if (!tracked.trim())
          return git(
            s.path,
            ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', path],
            { accept: [1] },
          );
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
    const gate = this.writers.get(s.gitDir) ?? new Gate(1);
    this.writers.set(s.gitDir, gate);
    const run = gate
      .run(() => this.perform(s, input))
      .finally(() => {
        this.running.delete(input.operationId);
        this.statuses.delete(s.gitDir || s.id);
      });
    this.running.set(input.operationId, run);
    return run;
  }
  private async perform(s: Session, input: Input<'git.act'>): Promise<Operation> {
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
        'Review the previous Git operation in the actions panel before starting another. Its result is uncertain.',
      );
    let op = this.store.get<Operation>('operations', input.operationId);
    if (op && (op.sessionId !== s.id || op.repositoryId !== input.repositoryId))
      throw new Error('This operation belongs to another worktree or repository.');
    const intent = digest(JSON.stringify({ ...input, operationId: undefined }));
    if (op?.evidence.intent && op.evidence.intent !== intent)
      throw new Error('This operation ID already belongs to another request.');
    if (op?.phase === 'completed') return op;
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
    const update = (phase: string) => {
      operation.phase = phase;
      delete operation.error;
      this.store.put('operations', operation);
      this.notify(operation);
    };
    try {
      if (input.action === 'stash' || input.action === 'stash-apply') {
        const files = parseStatus(
          await git(s.path, ['status', '--porcelain=v2', '--untracked-files=all', '-z']),
        ).files.filter((file) => file.index !== '?' || !file.path.endsWith('/'));
        operation.evidence.stashAction = input.action;
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
        if ((await git(s.path, ['status', '--porcelain', '--untracked-files=normal'])).trim())
          throw new Error('Commit or discard local changes before switching branches.');
        if (input.action === 'create-branch') safeRef(input.base || 'HEAD');
        const baseBranch =
          input.action === 'create-branch'
            ? await resolveBranch(s.path, input.base || 'HEAD')
            : undefined;
        Object.assign(operation.evidence, {
          branch: input.branch,
          baseBranch,
          initial: (await git(s.path, ['rev-parse', 'HEAD'])).trim(),
        });
        update('switching');
        await git(
          s.path,
          input.action === 'create-branch'
            ? ['switch', '-c', input.branch!, input.base || 'HEAD']
            : ['switch', '--', input.branch!],
        );
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
      const remote =
        input.action === 'commit'
          ? ''
          : (await git(s.path, ['remote', 'get-url', '--push', 'origin'])).trim();
      if (remote.startsWith('-'))
        throw new Error('The origin remote is not a valid publication target.');
      if (/^https?:\/\//.test(remote)) {
        const url = new URL(remote);
        if (url.username || url.password)
          throw new Error('Use a Git credential helper instead of credentials in the origin URL.');
      }
      const before = operation.evidence;
      if (before.branch && (before.branch !== branch || before.remote !== remote))
        throw new Error('The branch or remote changed. Review the target before continuing.');
      Object.assign(before, {
        branch,
        remote,
        initial: before.initial ?? initial,
        destination: branch,
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
        update('pushing');
        await this.network.run(() =>
          git(s.path, ['push', '--', remote, `${operation.commit}:${branch}`], { timeout: 120000 }),
        );
        const actual = (await git(s.path, ['ls-remote', '--', remote, branch]))
          .trim()
          .split(/\s/)[0];
        if (actual !== operation.commit) {
          update('needs-review');
          throw new Error('The remote branch moved. Inspect it before creating the pull request.');
        }
        before.remoteCommit = actual;
        if ((await git(s.path, ['remote', 'get-url', '--push', 'origin'])).trim() === remote) {
          const name = branch.slice('refs/heads/'.length);
          // Pushing a pinned OID does not update branch tracking.
          await git(s.path, ['update-ref', `refs/remotes/origin/${name}`, operation.commit]);
          if (
            !(
              await git(s.path, ['config', '--get', `branch.${name}.remote`], { accept: [1] })
            ).trim()
          )
            await git(s.path, ['branch', `--set-upstream-to=origin/${name}`, '--', name]);
        }
        update('pushed');
      }
      if (input.action === 'push') {
        update('completed');
        return operation;
      }
      const head = branch.slice('refs/heads/'.length);
      safeRef(input.base || 'main');
      if (
        input.action === 'pr' &&
        (await git(s.path, ['ls-remote', '--', remote, branch])).trim().split(/\s/)[0] !==
          operation.commit
      )
        throw new Error('Push this commit to origin before creating its pull request.');
      const found = JSON.parse(
        await this.github(
          s,
          [
            'pr',
            'list',
            '--state',
            'open',
            '--head',
            head,
            '--base',
            input.base || 'main',
            '--json',
            'number,url,headRefOid',
          ],
          undefined,
          remote,
        ),
      );
      if (found.length > 1)
        throw new Error('Multiple matching pull requests. Open GitHub to choose one.');
      if (found.length === 1) {
        if (found[0].headRefOid !== operation.commit) {
          update('needs-review');
          throw new Error('The existing pull request points to a different commit.');
        }
        operation.url = found[0].url;
      } else {
        update('creating-pr');
        const title =
          input.title?.trim() ||
          input.message?.trim().split('\n')[0] ||
          (await git(s.path, ['show', '-s', '--format=%s', operation.commit])).trim();
        const args = [
          'pr',
          'create',
          '--head',
          head,
          '--base',
          input.base || 'main',
          '--title',
          title,
          '--body-file',
          '-',
          ...(input.draft !== false ? ['--draft'] : []),
        ];
        operation.url = (await this.github(s, args, input.body || '', remote)).trim();
        const actual = JSON.parse(
          await this.github(
            s,
            ['pr', 'view', operation.url, '--json', 'headRefOid'],
            undefined,
            remote,
          ),
        );
        if (actual.headRefOid !== operation.commit) {
          update('needs-review');
          throw new Error('The pull request head changed. Review the created pull request.');
        }
      }
      update('completed');
      return operation;
    } catch (error: any) {
      operation.error = error.message || 'Git operation failed.';
      operation.phase = [
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
    if (operation.evidence.stashAction)
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
