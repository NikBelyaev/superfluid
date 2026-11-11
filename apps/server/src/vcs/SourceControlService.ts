import type { Session, ParsedInput } from '@superfluid/contracts';
import { GitService } from './GitService';
import { ProjectService } from '../project/ProjectService';
import { Store } from '../persistence/Store';
import { git } from './gitCommand';
import { within } from '../files/paths';
import { assertNoDrafts } from '../files/drafts';
import { relative } from 'node:path';
import { RepositoryService } from './RepositoryService';
import { realpath } from 'node:fs/promises';
import { RepositoryWorktreeService } from './RepositoryWorktreeService';
import type { WorkspaceWatcher } from '../workspace/WorkspaceWatcher';

export class SourceControlService {
  readonly repositories = new RepositoryService();
  private worktrees: RepositoryWorktreeService;
  constructor(
    private git: GitService,
    private projects: ProjectService,
    private store: Store,
    private watcher?: WorkspaceWatcher,
  ) {
    this.worktrees = new RepositoryWorktreeService(this.repositories, projects, store);
  }
  createWorktree(session: Session, input: ParsedInput<'git.worktree'>) {
    return this.worktrees.create(session, input);
  }
  async initialize(session: Session) {
    if (session.gitDir) throw new Error('This folder is already a Git repository.');
    await git(session.path, ['init', '-b', 'main']);
    await this.repositories.list(session, true);
    return this.projects.sessions(session.projectId);
  }
  private async fileTarget(session: Session, input: { repositoryId?: string; path?: string }) {
    let repositoryId = input.repositoryId;
    let path = input.path;
    if (!repositoryId && path) {
      const repository = (await this.repositories.list(session))
        .filter((r) => !r.path || path!.startsWith(r.path + '/'))
        .sort((a, b) => b.path.length - a.path.length)[0];
      repositoryId = repository?.id;
      if (repository?.path) path = path.slice(repository.path.length + 1);
    }
    const target = await this.repositories.target(session, repositoryId);
    await this.watcher?.observeGit(session, target.gitDir);
    if (path) await within(target.path, path, true);
    return { target, path };
  }
  async diff(session: Session, input: ParsedInput<'git.diff'>) {
    const { target, path } = await this.fileTarget(session, input);
    return this.git.diff(target, path, input.mode, input.base);
  }
  async index(session: Session, input: ParsedInput<'git.index'>) {
    const { target, path } = await this.fileTarget(session, input);
    return this.git.index(target, path!);
  }
  async status(session: Session, repositoryId?: string) {
    const target = await this.repositories.target(session, repositoryId);
    await this.watcher?.observeGit(session, target.gitDir);
    await this.git.recover(
      target,
      target.path === (await realpath(session.path)) ? undefined : repositoryId,
    );
    return this.git.status(target);
  }
  async act(session: Session, input: ParsedInput<'git.act'>) {
    const target = await this.repositories.target(session, input.repositoryId);
    const root = await realpath(session.path);
    if (
      ['commit', 'publish', 'create-branch', 'checkout', 'stash', 'stash-apply'].includes(
        input.action,
      )
    )
      assertNoDrafts(this.store, session, relative(root, await realpath(target.path)));
    for (const path of input.paths) await within(target.path, path, true);
    return this.git.act(target, {
      ...input,
      repositoryId: (await realpath(target.path)) === root ? undefined : input.repositoryId,
    });
  }
  async inspect(session: Session, operationId: string) {
    const operation = this.store.get<import('@superfluid/contracts').Operation>(
      'operations',
      operationId,
    );
    if (!operation || operation.sessionId !== session.id)
      throw new Error('Git operation not found.');
    return this.git.inspect(
      await this.repositories.target(session, operation.repositoryId),
      operationId,
    );
  }
}
