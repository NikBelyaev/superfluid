import { realpath, stat, mkdir, access } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join, basename, dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store';
import { Files, digest, within, logicalPath } from './files';
import { command, git, safeRef } from './process';
import { GitService } from './git';
import { LanguageServers } from './lsp';
import { Terminals } from './terminals';
import {
  requests,
  type AppEvent,
  type Session,
  type Project,
  type Action,
  type Method,
  type Input,
  type Results,
  type PullRequest,
} from '../../packages/contracts';

const identity = (value: string) => digest(value).slice(0, 24);
export class Workspace {
  readonly store: Store;
  readonly files = new Files();
  readonly git: GitService;
  readonly lsp: LanguageServers;
  readonly terminals: Terminals;
  private watchers = new Map<
    string,
    { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }
  >();
  constructor(
    directory: string,
    private emit: (event: AppEvent) => void,
    options: { terminalWorker?: URL } = {},
  ) {
    this.store = new Store(directory);
    this.git = new GitService(this.store, (operation) => emit({ type: 'operation', operation }));
    this.lsp = new LanguageServers(this.store, emit);
    this.terminals = new Terminals(emit, options.terminalWorker);
  }
  session(id: string) {
    const s = this.store.get<Session>('sessions', id);
    if (!s) throw new Error('Open a project before using this worktree.');
    return s;
  }
  private observe(s: Session) {
    if (this.watchers.has(s.id)) return;
    if (this.watchers.size >= 3) {
      const [id, old] = this.watchers.entries().next().value!;
      old.watcher.close();
      if (old.timer) clearTimeout(old.timer);
      this.watchers.delete(id);
    }
    try {
      const item: { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> } = {
        watcher: watch(s.path, { recursive: true }, (_event, path) => {
          if (path && /(?:^|\/)(?:node_modules|\.venv|__pycache__|\.ruff_cache)(?:\/|$)/.test(path))
            return;
          if (item.timer) return;
          item.timer = setTimeout(() => {
            item.timer = undefined;
            this.emit({ type: 'files.changed', sessionId: s.id });
          }, 200);
        }),
      };
      item.watcher.on('error', () => {
        item.watcher.close();
        this.watchers.delete(s.id);
      });
      this.watchers.set(s.id, item);
    } catch {}
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
  async call<M extends Method>(method: M, raw: Input<M>): Promise<Results[M]> {
    if (!(method in requests)) throw new Error('Unknown workspace operation.');
    const input: any = requests[method].parse(raw);
    const s: Session | undefined = input.sessionId ? this.session(input.sessionId) : undefined;
    let result: any;
    switch (method) {
      case 'bootstrap':
        result = {
          projects: this.store.all<Project>('projects').sort((a, b) => b.lastOpened - a.lastOpened),
          actions: this.store.all('actions'),
          runs: this.terminals.runs,
          operations: this.store.all('operations'),
        };
        break;
      case 'project.add':
        result = await this.add(input.path);
        break;
      case 'project.clone': {
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
        result = await this.add(target);
        break;
      }
      case 'session.list':
        result = await this.sessions(input.projectId);
        break;
      case 'session.create': {
        safeRef(input.branch);
        safeRef(input.base);
        await git(s!.path, ['check-ref-format', '--branch', input.branch]);
        const root = join(this.store.directory, 'worktrees', s!.projectId);
        await mkdir(root, { recursive: true });
        const path = join(
          root,
          `${input.branch.replace(/[^\w.-]/g, '-')}-${randomUUID().slice(0, 6)}`,
        );
        await git(s!.path, ['worktree', 'add', '-b', input.branch, path, input.base], {
          timeout: 120000,
        });
        const canonical = await realpath(path);
        result = (await this.sessions(s!.projectId)).find((x) => x.path === canonical);
        if (!result)
          throw new Error(
            'The worktree was created but could not be registered. Reopen the project to discover it.',
          );
        break;
      }
      case 'session.state':
        if (Buffer.byteLength(JSON.stringify(input.state)) > 256 * 1024)
          throw new Error('Layout is too large.');
        s!.state = input.state;
        this.store.put('sessions', s!);
        result = null;
        break;
      case 'session.interpreter':
        if (isAbsolute(input.python)) await access(input.python);
        else if (input.python !== 'python3' && input.python !== 'python')
          throw new Error('Choose an absolute interpreter path.');
        s!.python = input.python;
        this.store.put('sessions', s!);
        this.lsp.invalidate(s!.id);
        result = s;
        break;
      case 'files.list':
        this.observe(s!);
        result = await this.files.list(s!, input.path);
        break;
      case 'files.read': {
        this.observe(s!);
        logicalPath(s!.path, input.path);
        const draft = input.diskOnly ? undefined : this.store.getDraft(s!.id, input.path);
        const disk = await this.files.read(s!, input.path).catch((error: Error) => {
          if (!draft) throw error;
          return undefined;
        });
        result = draft
          ? {
              path: input.path,
              text: draft.text,
              diskText: disk?.text,
              hash: draft.hash,
              recovered: true,
              version: draft.version,
            }
          : disk;
        break;
      }
      case 'files.save':
        result = await this.files.save(s!, input.path, input.text, input.hash);
        break;
      case 'files.create':
        await this.files.create(s!, input.path, input.directory);
        result = null;
        break;
      case 'files.rename':
        this.assertNoDrafts(s!, input.path);
        await this.files.rename(s!, input.path, input.target);
        result = null;
        break;
      case 'files.resolve':
        this.assertNoDrafts(s!, input.path);
        await within(s!.path, input.path);
        result = resolve(s!.path, input.path);
        break;
      case 'files.search':
        result = await this.files.search(s!, input.query, input.content);
        break;
      case 'draft.put':
        if (!input.path) throw new Error('Choose a file path.');
        logicalPath(s!.path, input.path);
        if (Buffer.byteLength(input.text) > 2 * 1024 * 1024)
          throw new Error('This recovery document exceeds 2 MiB.');
        result = this.store.draft(input);
        break;
      case 'draft.drop':
        this.store.dropDraft(s!.id, input.path, input.version);
        result = null;
        break;
      case 'git.status':
        result = await this.git.status(s!);
        break;
      case 'git.init':
        if (s!.gitDir) throw new Error('This folder is already a Git repository.');
        await git(s!.path, ['init', '-b', 'main']);
        result = await this.sessions(s!.projectId);
        break;
      case 'git.diff':
        if (input.path) await within(s!.path, input.path, true);
        result = await this.git.diff(s!, input.path, input.mode, input.base);
        break;
      case 'git.act':
        if (['commit', 'publish'].includes(input.action)) this.assertNoDrafts(s!, '');
        result = await this.git.act(s!, input);
        break;
      case 'git.inspect':
        result = await this.git.inspect(s!, input.operationId);
        break;
      case 'git.acknowledge':
        result = this.git.acknowledge(s!, input.operationId);
        break;
      case 'actions.save': {
        if (!this.store.get('projects', input.projectId)) throw new Error('Project not found.');
        const action: Action = { ...input, id: input.id ?? randomUUID() };
        const old = this.store.get<Action>('actions', action.id);
        if (old && old.projectId !== action.projectId)
          throw new Error('This action belongs to another project.');
        this.store.put('actions', action);
        result = action;
        break;
      }
      case 'actions.delete':
        this.store.deleteAction(input.id);
        result = null;
        break;
      case 'terminal.run': {
        const action = input.actionId
          ? this.store.get<Action>('actions', input.actionId)
          : undefined;
        if (input.actionId && (!action || action.projectId !== s!.projectId))
          throw new Error('This action is not available in this project.');
        const cwd = await within(s!.path, action?.cwd || '');
        let file = process.env.SHELL || '/bin/zsh',
          args = ['-l'],
          shellCommand = action?.command || input.command;
        if (action?.kind === 'python') {
          file = s!.python;
          args = [await within(s!.path, action.command)];
          shellCommand = '';
        }
        if (action?.kind === 'django') {
          const url = new URL(action.previewUrl || 'http://127.0.0.1:8000');
          if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
            throw new Error(
              'The Django preset binds to localhost. Use a shell action for another host.',
            );
          file = s!.python;
          args = [
            await within(s!.path, action.command),
            'runserver',
            `${url.hostname}:${url.port || '8000'}`,
          ];
          shellCommand = '';
        }
        if (shellCommand) {
          args = ['-l', '-c', shellCommand];
          shellCommand = '';
        }
        result = await this.terminals.call('run', {
          sessionId: s!.id,
          cwd,
          file,
          args,
          shellCommand,
          name: action?.name || input.name,
          command: action?.command || input.command,
          previewUrl: action?.previewUrl,
        });
        break;
      }
      case 'terminal.command':
        result = await this.terminals.call('command', input);
        break;
      case 'lsp.open':
        await within(s!.path, input.path);
        await (await this.lsp.get(s!)).open(input.path, input.text, input.version);
        result = null;
        break;
      case 'lsp.close':
        await (await this.lsp.get(s!)).documentClose(input.path);
        result = null;
        break;
      case 'lsp.request': {
        const uri = input.params?.textDocument?.uri;
        if (typeof uri === 'string') {
          const file = fileURLToPath(uri);
          const rel = (await import('node:path')).relative(s!.path, file);
          await within(s!.path, rel);
        }
        result = await (await this.lsp.get(s!)).request(input.method, input.params);
        break;
      }
      case 'python.format':
        result = await command('ruff', ['format', '--stdin-filename', 'document.py', '-'], {
          cwd: s!.path,
          input: input.text,
        });
        break;
      case 'pr.read': {
        const fields =
          'number,title,body,state,url,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,comments,commits,reviews,statusCheckRollup,files';
        const raw = await this.git.github(s!, [
          'pr',
          'view',
          ...(input.number ? [String(input.number)] : []),
          '--json',
          fields,
        ]);
        const pr = JSON.parse(raw);
        if (
          typeof pr.number !== 'number' ||
          typeof pr.title !== 'string' ||
          !/^https:\/\//.test(pr.url)
        )
          throw new Error('Unexpected pull request response.');
        result = pr as PullRequest;
        break;
      }
      case 'pr.patch':
        result = await this.git.github(s!, [
          'pr',
          'diff',
          String(input.number),
          '--color',
          'never',
        ]);
        break;
      case 'pr.comment':
        await this.git.github(
          s!,
          ['pr', 'comment', String(input.number), '--body-file', '-'],
          input.body,
        );
        result = null;
        break;
      default:
        throw new Error('Unknown workspace operation.');
    }
    return result;
  }
  async close() {
    for (const w of this.watchers.values()) {
      w.watcher.close();
      if (w.timer) clearTimeout(w.timer);
    }
    this.lsp.close();
    await this.terminals.close();
    this.store.close();
  }
  private assertNoDrafts(s: Session, path: string) {
    const drafts = this.store
      .drafts(s.id)
      .filter((d) => !path || d.path === path || d.path.startsWith(path + '/'));
    if (drafts.length)
      throw new Error(
        'Save or discard the unsaved recovery drafts first: ' +
          drafts
            .slice(0, 5)
            .map((d) => d.path)
            .join(', '),
      );
  }
}
