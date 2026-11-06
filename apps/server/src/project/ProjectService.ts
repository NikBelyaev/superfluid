import { realpath, stat, mkdir, access } from 'node:fs/promises';
import { join, basename, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Session, ParsedInput } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { digest } from '../utils/digest';
import { command } from '../process/ProcessRunner';
import { git, safeRef } from '../vcs/gitCommand';

import { LanguageServers } from '../python/LanguageServers';

const identity = (value: string) => digest(value).slice(0, 24);

export class ProjectService {
  constructor(
    private store: Store,
    private languages: LanguageServers,
  ) {}
  session(id: string) {
    const s = this.store.get<Session>('sessions', id);
    if (!s) throw new Error('Open a project before using this worktree.');
    return s;
  }
  async add(path: string): Promise<Project> {
    const root = await realpath(path);
    if (!(await stat(root)).isDirectory()) throw new Error('Choose a project folder.');
    const existing = this.store.all<Project>('projects').find((p) => p.path === root);
    const project: Project = {
      id: existing?.id ?? identity(root),
      name: basename(root),
      path: root,
      lastOpened: Date.now(),
    };
    this.store.put('projects', project);
    await this.sessions(project.id);
    return project;
  }
  async sessions(projectId: string): Promise<Session[]> {
    const p = this.store.get<Project>('projects', projectId);
    if (!p) throw new Error('Project not found.');
    let paths: { path: string; branch: string; head: string }[] = [];
    try {
      const raw = await git(p.path, ['worktree', 'list', '--porcelain', '-z']);
      let current: { path: string; branch: string; head: string } | undefined;
      for (const line of raw.split('\0')) {
        if (line.startsWith('worktree ')) {
          current = { path: line.slice(9), branch: 'Detached HEAD', head: '' };
          paths.push(current);
        } else if (current && line.startsWith('branch '))
          current.branch = line.slice(7).replace(/^refs\/heads\//, '');
        else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
        else if (line === 'bare' && current) {
          paths.pop();
          current = undefined;
        }
      }
    } catch {
      paths = [{ path: p.path, branch: '', head: '' }];
    }
    const result: Session[] = [];
    for (const entry of paths) {
      let gitDir = '',
        available = true;
      try {
        await access(entry.path);
        gitDir = (await git(entry.path, ['rev-parse', '--absolute-git-dir'])).trim();
      } catch {
        try {
          await access(entry.path);
        } catch {
          available = false;
        }
      }
      const old = this.store
        .all<Session>('sessions')
        .find(
          (s) => s.projectId === p.id && (s.path === entry.path || (gitDir && s.gitDir === gitDir)),
        );
      let python = old?.python || 'python3';
      if (!old?.python) {
        const local = join(entry.path, '.venv', 'bin', 'python');
        try {
          await access(local);
          python = local;
        } catch {}
      }
      const s: Session = {
        ...entry,
        id: old?.id ?? identity(`${p.id}:${gitDir || entry.path}`),
        projectId: p.id,
        gitDir,
        python,
        state: old?.state ?? {},
        available,
      };
      this.store.put('sessions', s);
      result.push(s);
    }
    return result;
  }
  async clone(input: ParsedInput<'project.clone'>) {
    if (
      !/^(https:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[^\s:]+:[^\s]+)$/.test(input.url) ||
      input.url.includes('\0')
    )
      throw new Error('Use an HTTPS or SSH Git repository URL.');
    if (
      input.url.startsWith('https:') &&
      (new URL(input.url).password || new URL(input.url).username)
    )
      throw new Error('Use your Git credential helper instead of a token in the URL.');
    const parent = await realpath(dirname(input.destination));
    const target = join(parent, basename(input.destination));
    await command('git', ['clone', '--', input.url, target], { cwd: parent, timeout: 120000 });
    return this.add(target);
  }
  async createWorktree(session: Session, input: ParsedInput<'session.create'>) {
    safeRef(input.branch);
    safeRef(input.base);
    await git(session.path, ['check-ref-format', '--branch', input.branch]);
    const root = join(this.store.directory, 'worktrees', session.projectId);
    await mkdir(root, { recursive: true });
    const path = join(root, `${input.branch.replace(/[^\w.-]/g, '-')}-${randomUUID().slice(0, 6)}`);
    await git(session.path, ['worktree', 'add', '-b', input.branch, path, input.base], {
      timeout: 120000,
    });
    const canonical = await realpath(path);
    const result = (await this.sessions(session.projectId)).find((x) => x.path === canonical);
    if (!result)
      throw new Error(
        'The worktree was created but could not be registered. Reopen the project to discover it.',
      );
    return result;
  }
  saveState(session: Session, input: ParsedInput<'session.state'>) {
    if (Buffer.byteLength(JSON.stringify(input.state)) > 256 * 1024)
      throw new Error('Layout is too large.');
    session.state = input.state;
    this.store.put('sessions', session);
    return null;
  }
  async setInterpreter(session: Session, input: ParsedInput<'session.interpreter'>) {
    if (isAbsolute(input.python)) await access(input.python);
    else if (input.python !== 'python3' && input.python !== 'python')
      throw new Error('Choose an absolute interpreter path.');
    session.python = input.python;
    this.store.put('sessions', session);
    this.languages.invalidate(session.id);
    return session;
  }
}
