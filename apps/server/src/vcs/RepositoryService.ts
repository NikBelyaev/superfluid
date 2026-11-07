import { readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { GitRepository, Session } from '@superfluid/contracts';
import { within } from '../files/paths';
import { digest } from '../utils/digest';
import { git } from './gitCommand';

const excluded = new Set([
  'node_modules',
  '__pycache__',
  'site-packages',
  'dist',
  'build',
  'coverage',
]);

function providerFor(remote: string) {
  let host = '';
  try {
    if (remote.includes('://')) {
      const url = new URL(remote);
      if (['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) host = url.hostname;
    } else host = remote.match(/^(?:[^/@:\s]+@)?([^/:\s]+):.+/)?.[1] || '';
  } catch {
    return;
  }
  host = host.toLowerCase();
  if (host.endsWith('.ghe.com')) return 'github';
  return host.split('.').find((part) => part === 'github' || part === 'gitlab');
}

export class RepositoryService {
  private discovered = new Map<string, Promise<GitRepository[]>>();

  list(session: Session, refresh = false) {
    let work = this.discovered.get(session.id);
    if (!work || refresh) {
      work = this.discover(session).catch((error: unknown) => {
        this.discovered.delete(session.id);
        throw error;
      });
      this.discovered.set(session.id, work);
    }
    return work;
  }

  private async discover(session: Session) {
    const repositories: GitRepository[] = [];
    const pending = [session.path];
    while (pending.length) {
      const directory = pending.pop()!;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (directory === session.path) throw error;
        continue;
      }
      if (entries.some((entry) => entry.name === 'pyvenv.cfg')) continue;
      if (entries.some((entry) => entry.name === '.git')) {
        const path = relative(session.path, directory);
        const [branch, remote] = await Promise.all([
          git(directory, ['symbolic-ref', '--short', '--quiet', 'HEAD'], { accept: [1] })
            .then((value) => value.trim() || 'Detached HEAD')
            .catch(() => 'Git unavailable'),
          git(directory, ['remote', 'get-url', '--push', 'origin'])
            .then((value) => value.trim())
            .catch(() => ''),
        ]);
        repositories.push({
          id: digest(`${session.id}:${path}`).slice(0, 24),
          path,
          branch,
          provider: providerFor(remote),
        });
      }
      for (const entry of entries)
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !excluded.has(entry.name) &&
          !/^venv(?:\d|$)/.test(entry.name)
        )
          pending.push(join(directory, entry.name));
    }
    return repositories.sort((a, b) => a.path.localeCompare(b.path));
  }

  async target(session: Session, repositoryId?: string) {
    if (!repositoryId) return session;
    const repository = (await this.list(session)).find((r) => r.id === repositoryId);
    if (!repository)
      throw new Error('This repository does not belong to the worktree. Refresh repositories.');
    const path = await within(session.path, repository.path);
    const root = await realpath((await git(path, ['rev-parse', '--show-toplevel'])).trim());
    if (root !== path)
      throw new Error('The repository moved or was removed. Refresh repositories.');
    const gitDir = (await git(path, ['rev-parse', '--absolute-git-dir'])).trim();
    return { ...session, path, gitDir };
  }
}
