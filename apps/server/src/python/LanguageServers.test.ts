import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:net';
import { ProjectService } from '../project/ProjectService';
import { inspectInterpreter, languageServerFor } from './interpreter';
import { Store } from '../persistence/Store';
import { command } from '../process/ProcessRunner';
import { git } from '../vcs/gitCommand';
import { Workspace } from '../workspace/Workspace';
import { LanguageServers } from './LanguageServers';
import { temp, session, repository, terminalWorker, pythonProbe } from '../../../../tests/fixtures';

async function controlledProbe(root: string) {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const script = `#!${process.execPath}\nrequire('node:net').connect(${address.port}, '127.0.0.1').pipe(process.stdout);\n`;
  const paths = [join(root, 'first-python'), join(root, 'last-python')];
  await Promise.all(paths.map((path) => writeFile(path, script, { mode: 0o755 })));
  return { socket, paths };
}

test('the latest interpreter selection wins without overwriting newer session state', async () => {
  const root = await temp(),
    store = new Store(await temp());
  const languages = new LanguageServers(store, () => {});
  const projects = new ProjectService(store, languages);
  const s = session(root);
  store.put('sessions', s);
  const { socket, paths } = await controlledProbe(root);
  const interpreter = await inspectInterpreter('python3', root);
  try {
    const firstConnection = once(socket, 'connection');
    const first = projects.setInterpreter(s, { sessionId: s.id, python: paths[0] });
    const rejected = assert.rejects(first, /newer Python interpreter/);
    const [firstSocket] = await firstConnection;
    const lastConnection = once(socket, 'connection');
    const last = projects.setInterpreter(projects.session(s.id), {
      sessionId: s.id,
      python: paths[1],
    });
    const [lastSocket] = await lastConnection;
    projects.saveState(projects.session(s.id), { sessionId: s.id, state: { active: 'new.py' } });
    lastSocket.end(JSON.stringify(interpreter));
    await last;
    firstSocket.end(JSON.stringify(interpreter));
    await rejected;
    assert.equal(projects.session(s.id).python, paths[1]);
    assert.deepEqual(projects.session(s.id).state, { active: 'new.py' });
  } finally {
    languages.close();
    socket.close();
    store.close();
  }
});

test('parallel requests share a startup and release prevents its delayed process from launching', async () => {
  const root = await temp(),
    store = new Store(await temp());
  const events: string[] = [];
  const languages = new LanguageServers(store, (event) => {
    if (event.type === 'lsp.status') events.push(event.phase);
  });
  const { socket, paths } = await controlledProbe(root);
  const interpreter = await inspectInterpreter('python3', root);
  try {
    const connection = once(socket, 'connection');
    const s = { ...session(root), python: paths[0] };
    const [first, second] = await Promise.all([languages.get(s), languages.get(s)]);
    assert.equal(first, second);
    const opening = assert.rejects(first.open('main.py', '', 1), /released/);
    const [probe] = await connection;
    languages.invalidate(s.id);
    probe.end(JSON.stringify(interpreter));
    await opening;
    assert.equal((first as any).child, undefined);
    assert.ok(!events.includes('ready'));
  } finally {
    languages.close();
    socket.close();
    store.close();
  }
});

test('Python server choice compares major and minor versions numerically', () => {
  for (const [minor, expected] of [
    [8, 'pyright'],
    [9, 'pyright'],
    [10, 'ty'],
    [11, 'ty'],
    [14, 'ty'],
  ] as const)
    assert.equal(languageServerFor([3, minor]), expected);
});

test('failed ty startup falls back to Pyright with a visible reason', async () => {
  const root = await temp(),
    store = new Store(await temp());
  const events: string[] = [];
  const languages = new LanguageServers(store, (event) => {
    if (event.type === 'lsp.status' && event.phase === 'ready') events.push(event.status);
  });
  const original = process.env.SF_TY_PATH;
  process.env.SF_TY_PATH = join(root, 'missing-ty');
  try {
    const s = { ...session(root), python: await pythonProbe(root, [3, 10]) };
    const server = await languages.get(s);
    await server.open('main.py', 'value = 1\n', 1);
    assert.equal(server.kind, 'pyright');
    assert.equal(await languages.get(s), server);
    assert.equal(events.length, 1);
    assert.match(events[0], /Pyright ready.*ty unavailable/);
  } finally {
    if (original === undefined) delete process.env.SF_TY_PATH;
    else process.env.SF_TY_PATH = original;
    languages.close();
    store.close();
  }
});

test('rejecting an invalid interpreter preserves the saved session and its language server', async () => {
  const root = await repository();
  const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
  try {
    const project = await workspace.projects.add(root);
    const [s] = await workspace.projects.sessions(project.id);
    const server = await workspace.lsp.get(s);
    await server.open('main.py', 'value = 1\n', 1);
    const invalid = join(root, 'not-python');
    await writeFile(invalid, '#!/bin/sh\nprintf "not Python"\n', { mode: 0o755 });
    await assert.rejects(
      workspace.call('session.interpreter', { sessionId: s.id, python: invalid }),
      /interpreter|Python/i,
    );
    assert.equal(workspace.projects.session(s.id).python, s.python);
    assert.equal(await workspace.lsp.get(s), server);
  } finally {
    await workspace.close();
  }
});

test('Python definitions use unsaved overlays after language server eviction', async () => {
  const root = await temp(),
    store = new Store(await temp()),
    events = new EventEmitter(),
    servers = new LanguageServers(store, (event) => {
      if (
        event.type === 'diagnostics' &&
        event.uri.endsWith('/main.py') &&
        !event.diagnostics.length
      )
        events.emit('clean', event);
    });
  await writeFile(join(root, 'models.py'), 'class DiskOnly: pass\n');
  const text = 'class Recovered:\n    def size(self) -> int:\n        return 1\n';
  await writeFile(join(root, 'main.py'), 'from models import Recovered\nx = Recovered()\n');
  const s = session(root);
  store.draft({
    sessionId: s.id,
    path: 'main.py',
    text: 'from models import Recovered\nx = Recovered()\n',
    hash: 'disk',
    version: 1,
  });
  store.draft({ sessionId: s.id, path: 'models.py', text, hash: 'disk', version: 2 });
  try {
    for (let i = 0; i < 2; i++) {
      const clean = once(events, 'clean', { signal: AbortSignal.timeout(10000) });
      const server = await servers.get(s);
      await server.open('main.py', 'from models import Recovered\nx = Recovered()\n', 1);
      await clean;
      const result = await server.request('textDocument/definition', {
        textDocument: { uri: pathToFileURL(join(root, 'main.py')).href },
        position: { line: 1, character: 5 },
      });
      assert.ok(result?.length > 0, JSON.stringify(result));
      assert.match(result[0].uri, /models\.py$/);
      const symbols = await server.request('textDocument/documentSymbol', {
        textDocument: { uri: pathToFileURL(join(root, 'models.py')).href },
      });
      assert.equal(symbols[0].name, 'Recovered');
      assert.equal(symbols[0].children?.[0]?.name, 'size');
      assert.deepEqual(symbols[0].children[0].range.start, { line: 1, character: 4 });
      const renamed = await server.request('textDocument/rename', {
        textDocument: { uri: pathToFileURL(join(root, 'main.py')).href },
        position: { line: 1, character: 5 },
        newName: 'Renamed',
      });
      const renamedUris = renamed.documentChanges
        ? renamed.documentChanges.map((change: any) => change.textDocument.uri)
        : Object.keys(renamed.changes ?? {});
      assert.ok(
        renamedUris.some((uri: string) => uri.endsWith('/models.py')),
        'Renaming an imported class must include its definition.',
      );
      assert.ok(renamedUris.some((uri: string) => uri.endsWith('/main.py')));
      servers.invalidate(s.id);
    }
  } finally {
    servers.close();
    store.close();
  }
});

test('late Python messages and pipe errors stay contained after server release', async (t) => {
  const root = await temp(),
    store = new Store(await temp()),
    servers = new LanguageServers(store, () => {});
  try {
    const server = await servers.get(session(root));
    await server.open('main.py', 'value = 1\n', 1);
    const child = (server as any).child;
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    t.mock.method(server as any, 'requestRaw', () => {
      started();
      return pending;
    });
    const stale = assert.rejects(server.request('textDocument/hover', {}), /environment changed/);
    await requested;
    server.close();
    finish({ contents: 'stale' });
    await stale;
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'workspace/configuration',
      params: { items: [] },
    });
    assert.doesNotThrow(() =>
      child.stdout.emit(
        'data',
        Buffer.from(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`),
      ),
    );
    assert.doesNotThrow(() => child.stdin.emit('error', new Error('write EPIPE')));
  } finally {
    servers.close();
    store.close();
  }
});

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} uses the selected environment for completion, hover and live diagnostics`, async () => {
    const root = await temp(),
      store = new Store(await temp()),
      events = new EventEmitter(),
      servers = new LanguageServers(store, (event) => {
        if (event.type === 'diagnostics') events.emit('diagnostics', event);
      }),
      environment = join(root, 'chosen environment'),
      s = session(root);
    try {
      await command('python3', ['-m', 'venv', '--without-pip', environment], { cwd: root });
      s.python = join(environment, 'bin', 'python');
      const site = (
        await command(s.python, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], {
          cwd: root,
        })
      ).trim();
      await writeFile(join(site, 'installed_only.pyi'), 'def answer() -> int: ...\n');
      await writeFile(join(site, 'installed_only.py'), 'def answer(): return 42\n');
      await writeFile(
        join(root, 'pyrightconfig.json'),
        JSON.stringify({ reportAssignmentType: 'warning' }),
      );
      await writeFile(join(root, 'ty.toml'), '[rules]\ninvalid-assignment = "warn"\n');
      s.python = await pythonProbe(root, kind === 'ty' ? [3, 10] : [3, 9], s.python);
      await writeFile(join(root, 'main.py'), '');
      const server = await servers.get(s),
        uri = pathToFileURL(join(root, 'main.py')).href,
        diagnostic = once(events, 'diagnostics', { signal: AbortSignal.timeout(10000) });
      await server.open(
        'main.py',
        'from installed_only import answer\nvalue: str = answer()\ntext = "hello"\ntext.up\n',
        1,
      );
      const [event] = await diagnostic;
      assert.equal(server.kind, kind);
      assert.equal(event.sessionId, s.id);
      assert.equal(event.uri, uri);
      assert.ok(
        event.diagnostics.some(
          (d: any) =>
            d.code === (kind === 'ty' ? 'invalid-assignment' : 'reportAssignmentType') &&
            d.severity === 2,
        ),
      );
      assert.ok(!event.diagnostics.some((d: any) => d.code === 'reportMissingImports'));
      const completion = await server.request('textDocument/completion', {
        textDocument: { uri },
        position: { line: 3, character: 7 },
      });
      assert.ok((completion.items ?? completion).some((item: any) => item.label === 'upper'));
      const hover = await server.request('textDocument/hover', {
        textDocument: { uri },
        position: { line: 1, character: 15 },
      });
      assert.equal(hover.contents.kind, 'markdown');
      assert.match(hover.contents.value, /```python\n[\s\S]*answer\(\) -> int[\s\S]*```/);
      assert.match(JSON.stringify(hover), /int/);
      const symbols = await server.request('textDocument/documentSymbol', {
        textDocument: { uri },
      });
      assert.ok(symbols.some((symbol: any) => symbol.name === 'value'));
      const cleared = once(events, 'diagnostics', { signal: AbortSignal.timeout(10000) });
      await server.open(
        'main.py',
        'from installed_only import answer\nvalue: int = answer()\ntext = "hello"\ntext.upper()\n',
        2,
      );
      assert.deepEqual((await cleared)[0].diagnostics, []);
    } finally {
      servers.close();
      store.close();
    }
  });

for (const kind of ['ty', 'pyright'] as const)
  test(`${kind} refreshes imported files changed outside the editor and isolates worktrees`, async () => {
    const root = await repository(),
      events = new EventEmitter(),
      workspace = new Workspace(
        await temp(),
        (event) => {
          if (event.type === 'diagnostics') events.emit(event.sessionId, event);
        },
        { terminalWorker: terminalWorker },
      );
    const text = 'from dependency import answer\nvalue: str = answer()\n';
    await writeFile(join(root, 'dependency.py'), 'def answer() -> str: return "ok"\n');
    await writeFile(join(root, 'main.py'), text);
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'Python fixture']);
    try {
      const project = await workspace.projects.add(root),
        [main] = await workspace.projects.sessions(project.id),
        other = await workspace.call('session.create', {
          sessionId: main.id,
          branch: 'other',
          base: 'main',
        });
      for (const s of [main, other]) {
        s.python = await pythonProbe(s.path, kind === 'ty' ? [3, 10] : [3, 9]);
        workspace.store.put('sessions', s);
        const diagnostic = once(events, s.id, { signal: AbortSignal.timeout(10000) });
        await workspace.call('lsp.open', { sessionId: s.id, path: 'main.py', text, version: 1 });
        assert.deepEqual((await diagnostic)[0].diagnostics, []);
      }
      const changed = once(events, main.id, { signal: AbortSignal.timeout(10000) });
      await writeFile(join(root, 'dependency.py'), 'def answer() -> int: return 42\n');
      assert.ok(
        (await changed)[0].diagnostics.some(
          (d: any) => d.code === (kind === 'ty' ? 'invalid-assignment' : 'reportAssignmentType'),
        ),
      );
      for (const [s, expected] of [
        [main, 'int'],
        [other, 'str'],
      ] as const) {
        const hover = await workspace.call('lsp.request', {
          sessionId: s.id,
          method: 'textDocument/hover',
          params: {
            textDocument: { uri: pathToFileURL(join(s.path, 'main.py')).href },
            position: { line: 1, character: 15 },
          },
        });
        assert.match(JSON.stringify(hover.value), new RegExp(expected));
      }
    } finally {
      await workspace.close();
    }
  });
