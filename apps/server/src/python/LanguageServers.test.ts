import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter, once } from 'node:events';
import { Store } from '../persistence/Store';
import { command } from '../process/ProcessRunner';
import { git } from '../vcs/gitCommand';
import { Workspace } from '../workspace/Workspace';
import { LanguageServers } from './LanguageServers';
import { temp, session, repository, terminalWorker } from '../../../../tests/fixtures';

test('Python definitions use unsaved overlays after language server eviction', async () => {
  const root = await temp(),
    store = new Store(await temp()),
    servers = new LanguageServers(store, () => {});
  await writeFile(join(root, 'models.py'), 'class DiskOnly: pass\n');
  const text = 'class Recovered:\n    def size(self) -> int:\n        return 1\n';
  await writeFile(join(root, 'main.py'), 'from models import Recovered\nx = Recovered()\n');
  const s = session(root);
  store.draft({ sessionId: s.id, path: 'models.py', text, hash: 'disk', version: 2 });
  try {
    for (let i = 0; i < 2; i++) {
      const server = await servers.get(s);
      await server.open('main.py', 'from models import Recovered\nx = Recovered()\n', 1);
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

test('late Python messages and pipe errors stay contained after server release', async () => {
  const root = await temp(),
    store = new Store(await temp()),
    servers = new LanguageServers(store, () => {});
  try {
    const server = await servers.get(session(root));
    await server.open('main.py', 'value = 1\n', 1);
    const child = (server as any).child;
    server.close();
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

test('Pyright uses the selected environment for completion, hover and live diagnostics', async () => {
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
    assert.equal(event.sessionId, s.id);
    assert.equal(event.uri, uri);
    assert.ok(
      event.diagnostics.some((d: any) => d.code === 'reportAssignmentType' && d.severity === 2),
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
    assert.match(JSON.stringify(hover), /int/);
    const symbols = await server.request('textDocument/documentSymbol', { textDocument: { uri } });
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

test('Pyright refreshes imported files changed outside the editor and isolates worktrees', async () => {
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
      const diagnostic = once(events, s.id, { signal: AbortSignal.timeout(10000) });
      await workspace.call('lsp.open', { sessionId: s.id, path: 'main.py', text, version: 1 });
      assert.deepEqual((await diagnostic)[0].diagnostics, []);
    }
    const changed = once(events, main.id, { signal: AbortSignal.timeout(10000) });
    await writeFile(join(root, 'dependency.py'), 'def answer() -> int: return 42\n');
    assert.ok((await changed)[0].diagnostics.some((d: any) => d.code === 'reportAssignmentType'));
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
      assert.match(JSON.stringify(hover), new RegExp(expected));
    }
  } finally {
    await workspace.close();
  }
});
