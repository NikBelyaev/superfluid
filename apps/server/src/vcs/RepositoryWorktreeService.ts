import { mkdir, readdir, realpath, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ParsedInput, Session } from '@superfluid/contracts';
import { within } from '../files/paths';
import { Store } from '../persistence/Store';
import { ProjectService } from '../project/ProjectService';
import { RepositoryService } from './RepositoryService';
import { git, safeRef } from './gitCommand';
import { resolveBranch } from './branchBase';

async function removeEmptyDirectories(path: string) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (!entry.isDirectory()) throw new Error(`Kept unexpected files at ${path}`);
    await removeEmptyDirectories(join(path, entry.name));
  }
  await rmdir(path);
}

export class RepositoryWorktreeService {
  constructor(
    private repositories: RepositoryService,
    private projects: ProjectService,
    private store: Store,
  ) {}

  async create(session: Session, input: ParsedInput<'git.worktree'>) {
    safeRef(input.branch);
    safeRef(input.base);
    const available = await this.repositories.list(session, true);
    const ids = [...new Set(input.repositoryIds)];
    if (!ids.length || ids.some((id) => !available.some((r) => r.id === id)))
      throw new Error(
        'A selected repository does not belong to this worktree. Refresh repositories.',
      );
    const targets = [];
    for (const id of ids) {
      const repository = available.find((r) => r.id === id)!;
      const target = await this.repositories.target(session, id);
      await git(target.path, ['check-ref-format', '--branch', input.branch]);
      if (
        (
          await git(
            target.path,
            ['rev-parse', '--verify', '--quiet', `refs/heads/${input.branch}`],
            { accept: [1] },
          )
        ).trim()
      )
        throw new Error(`Branch ${input.branch} already exists in ${repository.path || 'root'}.`);
      const head = (
        await git(target.path, ['rev-parse', '--verify', `${safeRef(input.base)}^{commit}`])
      ).trim();
      const baseBranch = await resolveBranch(target.path, input.base);
      targets.push({ repository, target, head, baseBranch });
    }
    const directory = join(this.store.directory, 'worktrees', session.projectId);
    await mkdir(directory, { recursive: true });
    const path = join(
      directory,
      `${input.branch.replace(/[^\w.-]/g, '-')}-${randomUUID().slice(0, 8)}`,
    );
    const created: {
      source: string;
      path: string;
      head: string;
      branch: boolean;
      baseBranch?: string;
    }[] = [];
    const add = async (
      source: string,
      path: string,
      head: string,
      branch: boolean,
      baseBranch?: string,
    ) => {
      if (branch) await git(source, ['branch', input.branch, head]);
      created.push({ source, path, head, branch, baseBranch });
      if (baseBranch)
        await git(source, [
          'config',
          '--local',
          `branch.${input.branch}.gh-merge-base`,
          baseBranch,
        ]);
      await git(source, [
        'worktree',
        'add',
        ...(branch ? [] : ['--detach']),
        path,
        branch ? input.branch : head,
      ]);
    };
    try {
      const root = targets.find((t) => !t.repository.path);
      if (root) {
        await add(root.target.path, path, root.head, true, root.baseBranch);
      } else {
        const head = session.gitDir
          ? await git(session.path, ['rev-parse', '--verify', 'HEAD'], { accept: [1, 128] }).then(
              (s) => s.trim(),
            )
          : '';
        if (head) {
          await add(session.path, path, head, false);
        } else await mkdir(path);
      }
      for (const { repository, target, head, baseBranch } of targets
        .filter((t) => t.repository.path)
        .sort((a, b) => a.repository.path.length - b.repository.path.length)) {
        const destination = await within(path, repository.path, true);
        await mkdir(dirname(destination), { recursive: true });
        await add(target.path, destination, head, true, baseBranch);
      }
      return await this.projects.registerRepositoryWorktree(session, path, input.branch);
    } catch (error) {
      const cleanup: string[] = [];
      for (const entry of created.reverse()) {
        try {
          const canonical = await realpath(entry.path).catch((e: NodeJS.ErrnoException) => {
            if (e.code !== 'ENOENT') throw e;
            return entry.path;
          });
          const registered = (await git(entry.source, ['worktree', 'list', '--porcelain', '-z']))
            .split('\0')
            .includes(`worktree ${canonical}`);
          if (registered) await git(entry.source, ['worktree', 'remove', entry.path]);
          if (entry.branch)
            await git(entry.source, ['update-ref', '-d', `refs/heads/${input.branch}`, entry.head]);
          if (entry.baseBranch)
            await git(
              entry.source,
              [
                'config',
                '--local',
                '--fixed-value',
                '--unset',
                `branch.${input.branch}.gh-merge-base`,
                entry.baseBranch,
              ],
              { accept: [5] },
            );
        } catch (e) {
          cleanup.push(String(e));
        }
      }
      try {
        await removeEmptyDirectories(path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') cleanup.push(String(e));
      }
      if (cleanup.length) {
        await this.projects.registerRepositoryWorktree(session, path, input.branch).catch(() => {});
        throw new Error(
          `${String(error)}. Some worktrees were kept at ${path}. ${cleanup.join('; ')}`,
        );
      }
      throw error;
    }
  }
}
