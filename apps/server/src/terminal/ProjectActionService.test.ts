import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { git } from '../vcs/gitCommand';
import type { Action } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { ProjectActionService } from './ProjectActionService';
import { TerminalManager } from './TerminalManager';
import { session, temp, terminalWorker } from '../../../../tests/fixtures';

function milestone() {
  let resolve!: (result: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

async function goProject(files: Record<string, string>) {
  const root = await temp();
  await git(root, ['init', '-b', 'main']);
  await writeFile(join(root, 'go.mod'), 'module example.test/app\n\ngo 1.24.0\n');
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return root;
}

const goApp = 'package main\n\nfunc main() {}\n';

test('automatic actions are inserted once and respect custom actions and deletion across restarts', async () => {
  const root = await goProject({
    'cmd/server/main.go': goApp,
    'README.md': 'Go server',
    '.gitignore': '/scratch',
    'scratch/index.ts': 'export const value = 1;',
    Dockerfile: 'FROM scratch',
  });
  const data = await temp();
  let store = new Store(data);
  const terminals = new TerminalManager(() => {}, terminalWorker);
  try {
    let service = new ProjectActionService(store, terminals);
    store.put('projects', { id: 'project', name: 'Fixture', path: root, lastOpened: 0 });
    const [[action], [duplicate]] = await Promise.all([
      service.prepare('project'),
      service.prepare('project'),
    ]);
    assert.ok(action);
    assert.equal(duplicate?.id, action.id);
    assert.equal(action.kind, 'go');
    assert.equal(action.command, 'go run .');
    assert.equal(action.cwd, 'cmd/server');
    service.delete(action.id);

    const custom: Action = {
      ...action,
      id: 'custom',
      projectId: 'custom-project',
      kind: 'shell',
      command: 'echo custom',
    };
    store.put('projects', { id: custom.projectId, name: 'Custom', path: root, lastOpened: 0 });
    store.put('actions', custom);
    assert.deepEqual(await service.prepare(custom.projectId), [custom]);
    service.delete(custom.id);

    store.close();
    store = new Store(data);
    service = new ProjectActionService(store, terminals);
    assert.deepEqual(await service.prepare('project'), []);
    assert.deepEqual(await service.prepare(custom.projectId), []);
  } finally {
    await terminals.close();
    store.close();
  }
});

test('mixed-language and ambiguous repositories get no automatic action', async () => {
  const store = new Store(await temp());
  const terminals = new TerminalManager(() => {}, terminalWorker);
  const service = new ProjectActionService(store, terminals);
  try {
    const layouts: Record<string, Record<string, string>> = {
      mixed: { 'main.go': goApp, 'client/index.ts': 'export const value = 1;' },
      'unknown-source': { 'main.go': goApp, 'tools/task.janet': '(print "fixture")' },
      ambiguous: { 'main.go': goApp, 'cmd/worker/main.go': goApp },
      'unsupported-target': { 'app/main.go': goApp },
      'conditional-only': { 'main_linux.go': goApp },
      'literal-main': { 'greet.go': 'package main\nconst Fake = `\nfunc main() {}\n`' },
      'tagged-only': { 'main.go': '//go:build enterprise\n\n' + goApp },
    };
    for (const [id, files] of Object.entries(layouts)) {
      const path = await goProject(files);
      store.put('projects', { id, name: id, path, lastOpened: 0 });
      assert.deepEqual(await service.prepare(id), [], id);
    }
  } finally {
    await terminals.close();
    store.close();
  }
});

test('a Go action launches the package in its destination worktree', async () => {
  const project = await goProject({ 'main.go': goApp });
  const worktree = await temp();
  const bin = await temp();
  const store = new Store(await temp());
  const previousPath = process.env.PATH;
  const output = milestone();
  const terminals = new TerminalManager((event) => {
    if (event.type === 'error') output.resolve(event.message);
    if (event.type === 'runs' && event.runs.some((run) => run.state !== 'running'))
      output.resolve('Go exited before producing output');
    if (event.type !== 'terminal.frame') return;
    const { id, sequence, chunk, rows } = event.frame;
    if (rows.some(([, row]) => row.text.includes('GO_WORKTREE_READY')))
      output.resolve('GO_WORKTREE_READY');
    void terminals
      .call('command', { id, command: 'ack', data: { sequence, chunk } })
      .catch((error: Error) => output.resolve(error.message));
  }, terminalWorker);
  try {
    await writeFile(join(worktree, 'only-in-this-worktree'), 'fixture');
    await writeFile(
      join(bin, 'go'),
      '#!/bin/sh\n[ "$1" = run ] && [ "$2" = . ] && [ -f only-in-this-worktree ] || exit 23\nprintf "GO_WORKTREE_READY\\n"\nread -r line\n',
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`;
    store.put('projects', { id: 'project', name: 'Fixture', path: project, lastOpened: 0 });
    const service = new ProjectActionService(store, terminals);
    const [action] = await service.prepare('project');
    assert.ok(action);
    const destination = { ...session(worktree), id: 'other-worktree' };
    const run = await service.run(destination, {
      sessionId: destination.id,
      actionId: action.id,
      name: 'Terminal',
      command: '',
    });
    await terminals.call('command', { id: run.id, command: 'attach' });
    assert.equal(run.sessionId, destination.id);
    assert.equal(await output.promise, 'GO_WORKTREE_READY');
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await terminals.close();
    store.close();
  }
});

test('a shell action returns control to the user after its command finishes', async () => {
  const root = await temp();
  await writeFile(join(root, 'listed-file.txt'), 'fixture');
  const store = new Store(join(root, 'data'));
  const ready = milestone();
  const interactive = milestone();
  let listed = false;
  const terminals = new TerminalManager((event) => {
    if (event.type === 'error') {
      ready.resolve(event.message);
      interactive.resolve(event.message);
    }
    if (event.type === 'runs' && event.runs.some((run) => run.state !== 'running')) {
      ready.resolve('exited');
      interactive.resolve('exited');
    }
    if (event.type !== 'terminal.frame') return;
    const frame = event.frame;
    listed ||= frame.rows.some(([, row]) => row.text.includes('listed-file.txt'));
    if (frame.rows.some(([, row]) => row.text.includes('READY'))) ready.resolve('ready');
    if (frame.rows.some(([, row]) => row.text.includes('SECOND')))
      interactive.resolve('interactive');
    void terminals
      .call('command', {
        id: frame.id,
        command: 'ack',
        data: { sequence: frame.sequence, chunk: frame.chunk },
      })
      .catch((error: Error) => interactive.resolve(error.message));
  }, terminalWorker);
  const previousShell = process.env.SHELL;
  try {
    process.env.SHELL = '/bin/sh';
    store.put('projects', { id: 'project', name: 'Fixture', path: root, lastOpened: 0 });
    const service = new ProjectActionService(store, terminals);
    const action = service.save({
      projectId: 'project',
      name: 'List files',
      kind: 'shell',
      command: "ls; printf '\\122\\105\\101\\104\\131\\n'",
      cwd: '',
      shortcut: '',
      previewUrl: '',
    });
    const run = await service.run(session(root), {
      sessionId: 'test',
      actionId: action.id,
      name: 'Terminal',
      command: '',
    });
    await terminals.call('command', { id: run.id, command: 'attach' });
    assert.equal(await ready.promise, 'ready');
    assert.equal(listed, true);
    await terminals.call('command', {
      id: run.id,
      command: 'text',
      data: "printf '\\123\\105\\103\\117\\116\\104\\n'",
    });
    await terminals.call('command', {
      id: run.id,
      command: 'key',
      data: { key: 'Enter', code: 'Enter' },
    });
    assert.equal(await interactive.promise, 'interactive');
    assert.equal(terminals.runs.find((item) => item.id === run.id)?.state, 'running');
  } finally {
    if (previousShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShell;
    try {
      await terminals.close();
    } finally {
      store.close();
    }
  }
});
