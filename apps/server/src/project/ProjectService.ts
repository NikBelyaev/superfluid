import { realpath, stat, mkdir, access } from 'node:fs/promises';
import { join, basename, dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Session, ParsedInput } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { digest } from '../utils/digest';
import { command } from '../process/ProcessRunner';
import { git, safeRef } from '../vcs/gitCommand';
import { resolveBranch } from '../vcs/branchBase';

import { LanguageServers } from '../python/LanguageServers';
import { inspectInterpreter } from '../python/interpreter';

const identity = (value: string) => digest(value).slice(0, 24);

export class ProjectService {
  private interpreterSelections = new Map<string, symbol>();
  constructor(
    private store: Store,
    private languages: LanguageServers,
    private changed: (project: Project) => void = () => {},
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
      ...existing,
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
    for (const saved of this.store.all<Session>('sessions'))
      if (
        saved.projectId === projectId &&
        saved.repositoryWorktree &&
        !paths.some((p) => p.path === saved.path)
      )
        paths.push({ path: saved.path, branch: saved.branch, head: saved.head });
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
        ...(old?.repositoryWorktree ? { repositoryWorktree: true, branch: old.branch } : {}),
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
  async registerRepositoryWorktree(source: Session, path: string, branch: string) {
    const canonical = await realpath(path);
    const gitDir = await git(canonical, ['rev-parse', '--absolute-git-dir'])
      .then((s) => s.trim())
      .catch(() => '');
    const session: Session = {
      id: identity(`${source.projectId}:${gitDir || canonical}`),
      projectId: source.projectId,
      path: canonical,
      branch,
      head: '',
      gitDir,
      python: 'python3',
      state: {},
      available: true,
      repositoryWorktree: true,
    };
    this.store.put('sessions', session);
    return session;
  }
  async setRemote(session: Session, input: ParsedInput<'project.remote'>, target = session) {
    const project = this.store.get<Project>('projects', session.projectId);
    if (!project) throw new Error('Project not found.');
    if (input.remote) await git(target.path, ['remote', 'get-url', '--push', input.remote]);
    const updated = { ...project };
    const path = relative(session.path, target.path);
    if (path) {
      const remotes = { ...project.gitRemotes };
      if (input.remote) remotes[path] = input.remote;
      else delete remotes[path];
      if (Object.keys(remotes).length) updated.gitRemotes = remotes;
      else delete updated.gitRemotes;
    } else {
      delete updated.hosting;
      if (input.remote) updated.gitRemote = input.remote;
      else delete updated.gitRemote;
    }
    this.store.put('projects', updated);
    this.changed(updated);
    return updated;
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
    const baseBranch = await resolveBranch(session.path, input.base);
    const root = join(this.store.directory, 'worktrees', session.projectId);
    await mkdir(root, { recursive: true });
    const path = join(root, `${input.branch.replace(/[^\w.-]/g, '-')}-${randomUUID().slice(0, 6)}`);
    await git(session.path, ['worktree', 'add', '-b', input.branch, path, input.base], {
      timeout: 120000,
    });
    if (baseBranch)
      await git(session.path, [
        'config',
        '--local',
        `branch.${input.branch}.gh-merge-base`,
        baseBranch,
      ]);
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
    const selection = Symbol();
    this.interpreterSelections.set(session.id, selection);
    try {
      await inspectInterpreter(input.python, session.path);
      if (this.interpreterSelections.get(session.id) !== selection)
        throw new Error('A newer Python interpreter was selected.');
      const updated = { ...this.session(session.id), python: input.python };
      this.store.put('sessions', updated);
      const running = this.languages.invalidate(session.id);
      if (running) await this.languages.get(updated);
      return updated;
    } finally {
      if (this.interpreterSelections.get(session.id) === selection)
        this.interpreterSelections.delete(session.id);
    }
  }
}
