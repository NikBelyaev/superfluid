import type { GitFile, GitStatus, Operation, Session, Input } from '@superfluid/contracts';
import { command } from '../process/ProcessRunner';
import { git, safeRef } from './gitCommand';
import { Gate } from '../utils/Gate';

import { Store } from '../persistence/Store';
import { digest } from '../utils/digest';

export const unresolvedPhases = [
  'committing',
  'committed',
  'pushing',
  'pushed',
  'creating-pr',
  'uncertain',
  'needs-review',
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

export function parseStatus(output: string): Omit<GitStatus, 'branches' | 'repo'> {
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
    const existing = this.statuses.get(s.id);
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
          };
        const [raw, branches] = await Promise.all([
          git(s.path, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z'], {
            timeout: 5000,
          }),
          git(
            s.path,
            ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/'],
            { timeout: 5000 },
          ),
        ]);
        return {
          ...parseStatus(raw),
          branches: branches.trim().split('\n').filter(Boolean).slice(0, 1000),
          repo: true,
        };
      })
      .finally(() => this.statuses.delete(s.id));
    this.statuses.set(s.id, work);
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
      .finally(() => this.running.delete(input.operationId));
    this.running.set(input.operationId, run);
    return run;
  }
  private async perform(s: Session, input: Input<'git.act'>): Promise<Operation> {
    const unresolved = this.store
      .all<Operation>('operations')
      .find(
        (o) =>
          o.sessionId === s.id && o.id !== input.operationId && unresolvedPhases.includes(o.phase),
      );
    if (unresolved)
      throw new Error(
        'Review the previous Git operation in the actions panel before starting another. Its result is uncertain.',
      );
    let op = this.store.get<Operation>('operations', input.operationId);
    if (op && op.sessionId !== s.id) throw new Error('This operation belongs to another worktree.');
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
    op ??= { id: input.operationId, sessionId: s.id, phase: 'preparing', evidence: {} };
    const operation = op;
    operation.evidence.intent = intent;
    const update = (phase: string) => {
      operation.phase = phase;
      delete operation.error;
      this.store.put('operations', operation);
      this.notify(operation);
    };
    try {
      const branch = (await git(s.path, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
      if (!branch.startsWith('refs/heads/'))
        throw new Error('Create or select a named branch before publishing.');
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
        {
          if (!input.message?.trim()) throw new Error('Enter a commit message.');
          if (input.paths?.some((p) => !p || p.startsWith('/') || p.split('/').includes('..')))
            throw new Error('Choose paths inside this worktree.');
          if (input.paths?.length) await git(s.path, ['add', '--', ...input.paths]);
          const tree = (await git(s.path, ['write-tree'])).trim();
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
        const title = input.title?.trim() || input.message?.trim().split('\n')[0] || head;
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
      operation.phase = ['committing', 'pushing', 'creating-pr'].includes(operation.phase)
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
    const log = await git(s.path, ['log', '-8', '--oneline', '--decorate', '--all']).catch(
      (e: Error) => e.message,
    );
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
