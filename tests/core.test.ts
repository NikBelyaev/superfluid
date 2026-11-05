import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Files, digest, within } from '../apps/server/files';
import { Store } from '../apps/server/store';
import { GitService, parseStatus } from '../apps/server/git';
import { git, command } from '../apps/server/process';
import { Recovery } from '../apps/web/src/recovery';
import { GhosttyTerminalCore } from '../packages/ghostty/core';
import { loadGhosttyRuntime } from '../packages/ghostty/runtime';
import { Workspace } from '../apps/server/workspace';
import { LanguageServers } from '../apps/server/lsp';
import type { Session } from '../packages/contracts';

const temp = () => mkdtemp(join(tmpdir(), 'superfluid-test-'));
const session = (path: string): Session => ({
  id: 'test',
  projectId: 'project',
  path,
  branch: 'main',
  head: '',
  gitDir: join(path, '.git'),
  python: 'python3',
  state: {},
  available: true,
});
async function repository() {
  const root = await temp();
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Superfluid Test']);
  await git(root, ['config', 'user.email', 'test@superfluid.invalid']);
  await writeFile(join(root, 'main.py'), 'print("initial")\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'Initial']);
  return root;
}

test('file boundaries reject traversal and external symlinks', async () => {
  const root = await temp(),
    outside = await temp();
  await writeFile(join(outside, 'private.py'), 'secret');
  await symlink(outside, join(root, 'escape'));
  await assert.rejects(() => within(root, '../private.py'), /outside/);
  await assert.rejects(() => within(root, 'escape/private.py'), /outside/);
  await assert.rejects(() => within(root, '/etc/passwd'), /inside/);
});
test('save preserves BOM/CRLF and refuses external changes', async () => {
  const root = await temp(),
    files = new Files(),
    s = session(root);
  const original = '\ufeffprint("a")\r\n';
  await writeFile(join(root, 'main.py'), original);
  const doc = await files.read(s, 'main.py');
  assert.equal(doc.text, original);
  const next = '\ufeffprint("b")\r\n';
  const saved = await files.save(s, 'main.py', next, doc.hash);
  assert.equal(saved.hash, digest(next));
  assert.equal(await readFile(join(root, 'main.py'), 'utf8'), next);
  await writeFile(join(root, 'main.py'), 'external');
  await assert.rejects(() => files.save(s, 'main.py', 'mine', saved.hash), /changed on disk/);
  assert.equal(await readFile(join(root, 'main.py'), 'utf8'), 'external');
});
test('parallel saves with the same baseline cannot overwrite each other', async () => {
  const root = await temp(),
    files = new Files(),
    s = session(root);
  await writeFile(join(root, 'main.py'), 'initial');
  const doc = await files.read(s, 'main.py');
  const results = await Promise.allSettled([
    files.save(s, 'main.py', 'first', doc.hash),
    files.save(s, 'main.py', 'second', doc.hash),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await readFile(join(root, 'main.py'), 'utf8'), 'first');
});
test('recovery drafts never regress to a late version', async () => {
  const store = new Store(await temp());
  try {
    store.draft({ sessionId: 'a', path: 'main.py', text: 'new', hash: 'disk', version: 3 });
    store.draft({ sessionId: 'a', path: 'main.py', text: 'old', hash: 'disk', version: 2 });
    assert.equal(store.drafts('a')[0].text, 'new');
    assert.equal(store.drafts('a')[0].version, 3);
  } finally {
    store.close();
  }
});
test('an older save cannot drop a newer recovery draft', async () => {
  const store = new Store(await temp());
  try {
    store.draft({
      sessionId: 'a',
      path: 'main.py',
      text: 'typed during save',
      hash: 'old',
      version: 4,
    });
    store.dropDraft('a', 'main.py', 3);
    assert.equal(store.drafts('a')[0].version, 4);
    store.dropDraft('a', 'main.py', 4);
    assert.equal(store.drafts('a').length, 0);
  } finally {
    store.close();
  }
});
test('recovery flush drains many dirty files with at most two writers', async () => {
  const r = new Recovery(() => {}, 5000, 5000);
  let active = 0,
    peak = 0,
    written = 0;
  for (let i = 0; i < 8; i++)
    r.changed({
      key: String(i),
      version: () => 1,
      text: () => String(i),
      hash: () => '',
      write: async (v) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        written++;
        return { version: v };
      },
    });
  await r.flushAll();
  assert.equal(written, 8);
  assert.equal(peak, 2);
  for (let i = 0; i < 8; i++) r.forget(String(i));
});
test('a new disk baseline is durably checkpointed even at the same edit version', async () => {
  const r = new Recovery(() => {}, 5000, 5000);
  let hash = 'old';
  const saved: string[] = [];
  r.changed({
    key: 'doc',
    version: () => 1,
    text: () => '',
    hash: () => hash,
    write: async (version) => {
      saved.push(hash);
      return { version };
    },
  });
  await r.flushAll();
  hash = 'new';
  await r.rebase('doc');
  assert.deepEqual(saved, ['old', 'new']);
  r.forget('doc');
});
test('continuous edits trigger recovery without waiting for idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let version = 0;
  const writes: { version: number; time: number }[] = [],
    errors: Error[] = [];
  const recovery = new Recovery((e) => errors.push(e), 50, 100);
  const source = {
    key: 'doc',
    version: () => version,
    text: () => String(version),
    hash: () => '',
    write: async (v: number) => {
      writes.push({ version: v, time: Date.now() });
      return { version: v };
    },
  };
  for (let i = 0; i < 20; i++) {
    version++;
    recovery.changed(source);
    t.mock.timers.tick(20);
    for (let n = 0; n < 8; n++) await Promise.resolve();
  }
  await recovery.flushAll();
  assert.ok(writes.length >= 3);
  assert.ok(writes[0].time <= 1100);
  assert.equal(writes.at(-1)!.version, version);
  assert.equal(errors.length, 0);
  recovery.forget('doc');
});
test('an old recovery acknowledgement cannot cover newer edits', async () => {
  let version = 1;
  let resolveFirst!: (v: { version: number }) => void;
  let count = 0;
  const r = new Recovery(() => {}, 5000, 5000);
  const source = {
    key: 'doc',
    version: () => version,
    text: () => String(version),
    hash: () => '',
    write: (v: number) => {
      count++;
      return count === 1
        ? new Promise<{ version: number }>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({ version: v });
    },
  };
  r.changed(source);
  const first = r.flush('doc');
  version = 2;
  r.changed(source);
  resolveFirst({ version: 1 });
  await first;
  assert.equal(r.durable('doc', 2), false);
  await r.flushAll();
  assert.equal(r.durable('doc', 2), true);
  r.forget('doc');
});
test('porcelain parsing preserves whitespace and rename paths', () => {
  const result = parseStatus(
    '# branch.oid abc\0# branch.head main\0# branch.ab +2 -1\0' +
      '1 .M N... 100644 100644 100644 aaa bbb folder/odd name\n.py\0' +
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.py\0old.py\0? brand new.py\0',
  );
  assert.equal(result.branch, 'main');
  assert.equal(result.ahead, 2);
  assert.equal(result.files[0].path, 'folder/odd name\n.py');
  assert.equal(result.files[1].original, 'old.py');
  assert.equal(result.files[2].path, 'brand new.py');
});
test('publication uses a verified commit and explicit destination ref', async () => {
  const root = await repository(),
    remote = await temp();
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  const store = new Store(await temp()),
    events: any[] = [],
    service = new GitService(store, (o) => events.push(structuredClone(o)));
  const s = session(root);
  try {
    await writeFile(join(root, 'main.py'), 'print("modified")\n');
    const op = await service.act(s, {
      sessionId: s.id,
      operationId: 'commit-1',
      action: 'commit',
      message: 'Change',
      paths: ['main.py'],
    });
    assert.equal(op.phase, 'completed');
    assert.ok(op.commit);
    const again = await service.act(s, {
      sessionId: s.id,
      operationId: 'commit-1',
      action: 'commit',
      message: 'Change',
      paths: ['main.py'],
    });
    assert.equal(again.commit, op.commit);
    const push = await service.act(s, { sessionId: s.id, operationId: 'push-1', action: 'push' });
    assert.equal(push.phase, 'completed');
    assert.equal((await git(remote, ['rev-parse', 'refs/heads/main'])).trim(), op.commit);
    assert.ok(events.some((e) => e.phase === 'committing'));
  } finally {
    store.close();
  }
});
test('a first local commit needs no Git remote', async () => {
  const root = await temp();
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Superfluid Test']);
  await git(root, ['config', 'user.email', 'test@superfluid.invalid']);
  await writeFile(join(root, 'first.py'), 'print(1)\n');
  const store = new Store(await temp());
  try {
    const op = await new GitService(store, () => {}).act(session(root), {
      sessionId: 'test',
      operationId: 'initial',
      action: 'commit',
      message: 'First',
      paths: ['first.py'],
    });
    assert.equal(op.phase, 'completed', op.error ?? '');
    assert.equal((await git(root, ['rev-list', '--count', 'HEAD'])).trim(), '1');
  } finally {
    store.close();
  }
});
test('diffs include untracked files and files whose parent directory was deleted', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {});
  try {
    await writeFile(join(root, 'new.py'), 'new value\n');
    assert.match(await service.diff(session(root), 'new.py', 'unstaged', 'HEAD'), /\+new value/);
    await mkdir(join(root, 'removed'));
    await writeFile(join(root, 'removed', 'old.py'), 'old value\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'More files']);
    await import('node:fs/promises').then((fs) =>
      fs.rm(join(root, 'removed'), { recursive: true }),
    );
    await within(root, 'removed/old.py', true);
    assert.match(
      await service.diff(session(root), 'removed/old.py', 'unstaged', 'HEAD'),
      /-old value/,
    );
  } finally {
    store.close();
  }
});
test('publish pipeline creates one PR and retries the same operation without side effects', async () => {
  const root = await repository(),
    remote = await temp(),
    bin = await temp(),
    store = new Store(await temp()),
    oldPath = process.env.PATH;
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  const calls = join(bin, 'calls.json');
  await writeFile(
    join(bin, 'gh'),
    '#!' +
      process.execPath +
      '\n' +
      `const fs=require('node:fs');const cp=require('node:child_process');const args=process.argv.slice(2);const file=${JSON.stringify(calls)};const calls=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];calls.push(args);fs.writeFileSync(file,JSON.stringify(calls));if(args[1]==='list')console.log('[]');else if(args[1]==='create')console.log('https://github.com/superfluid-test/fixture/pull/1');else console.log(JSON.stringify({headRefOid:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}));`,
    { mode: 0o755 },
  );
  process.env.PATH = bin + ':' + oldPath;
  try {
    await writeFile(join(root, 'main.py'), 'print("published")\n');
    const service = new GitService(store, () => {}),
      input = {
        sessionId: 'test',
        operationId: 'publish',
        action: 'publish' as const,
        message: 'Publish',
        paths: ['main.py'],
        body: 'A multiline\nbody',
      };
    const op = await service.act(session(root), input);
    assert.equal(op.phase, 'completed', op.error ?? '');
    assert.match(op.url!, /\/pull\/1$/);
    await service.act(session(root), input);
    assert.equal(
      JSON.parse(await readFile(calls, 'utf8')).filter((a: string[]) => a[1] === 'create').length,
      1,
    );
  } finally {
    process.env.PATH = oldPath;
    store.close();
  }
});
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
      const renamed = await server.request('textDocument/rename', {
        textDocument: { uri: pathToFileURL(join(root, 'main.py')).href },
        position: { line: 1, character: 5 },
        newName: 'Renamed',
      });
      assert.ok(
        renamed.documentChanges.some((change: any) =>
          change.textDocument.uri.endsWith('/models.py'),
        ),
        'Renaming an imported class must include its definition.',
      );
      assert.ok(
        renamed.documentChanges.some((change: any) => change.textDocument.uri.endsWith('/main.py')),
      );
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
test('a post-commit ref change stops publication without resetting the branch', async () => {
  const root = await repository();
  await git(root, ['branch', 'other']);
  const remote = await temp();
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await writeFile(
    join(root, '.git', 'hooks', 'post-commit'),
    '#!/bin/sh\ngit symbolic-ref HEAD refs/heads/other\n',
    { mode: 0o755 },
  );
  await writeFile(join(root, 'main.py'), 'changed\n');
  const store = new Store(await temp());
  try {
    const op = await new GitService(store, () => {}).act(session(root), {
      sessionId: 'test',
      operationId: 'race',
      action: 'publish',
      message: 'Change',
      paths: ['main.py'],
    });
    assert.equal(op.phase, 'needs-review');
    assert.equal((await git(root, ['branch', '--show-current'])).trim(), 'other');
    assert.equal((await git(remote, ['show-ref'], { accept: [1] })).trim(), '');
  } finally {
    store.close();
  }
});
test('Ghostty retains alternate screen and modes without replaying old PTY queries', async () => {
  const replies: string[] = [];
  const core = await GhosttyTerminalCore.create(
    80,
    24,
    8,
    18,
    {
      foreground: { r: 0, g: 0, b: 0 },
      background: { r: 255, g: 255, b: 255 },
      cursor: { r: 0, g: 0, b: 0 },
    },
    (s) => replies.push(s),
  );
  try {
    core.write('normal\r\n'.repeat(6000));
    core.write('\x1b[?1049h\x1b[?1h\x1b[2J\x1b[Halternate screen');
    assert.equal(core.isAlternateScreen(), true);
    assert.equal(core.isApplicationCursorKeys(), true);
    assert.match(core.snapshot().rowData[0].text, /alternate screen/);
    core.write('\x1b[6n');
    const n = replies.length;
    for (let i = 0; i < 10; i++) core.snapshot();
    assert.equal(replies.length, n);
    assert.equal(core.isAlternateScreen(), true);
  } finally {
    core.dispose();
  }
});
test('worktrees have independent document recovery and real PTY survives detach', async () => {
  const root = await repository(),
    data = await temp();
  const w = new Workspace(data, () => {}, {
    terminalWorker: new URL('../dist/terminal-worker.mjs', import.meta.url),
  });
  try {
    const project = await w.add(root),
      [main] = await w.sessions(project.id);
    const feature = await w.call('session.create', {
      sessionId: main.id,
      branch: 'feature/parallel',
      base: 'main',
    });
    assert.notEqual(main.id, feature.id);
    const a = await w.call('files.read', { sessionId: main.id, path: 'main.py' });
    await w.call('draft.put', {
      sessionId: main.id,
      path: 'main.py',
      text: 'main draft',
      hash: a.hash,
      version: 1,
    });
    assert.equal(
      (await w.call('files.read', { sessionId: feature.id, path: 'main.py' })).text,
      'print("initial")\n',
    );
    assert.equal(
      (await w.call('files.read', { sessionId: main.id, path: 'main.py' })).text,
      'main draft',
    );
    await import('node:fs/promises').then((fs) => fs.unlink(join(root, 'main.py')));
    assert.equal(
      (await w.call('files.read', { sessionId: main.id, path: 'main.py' })).text,
      'main draft',
    );
    await assert.rejects(
      () => w.call('files.read', { sessionId: main.id, path: 'main.py', diskOnly: true }),
      /ENOENT/,
    );
    assert.equal(w.store.getDraft(main.id, 'main.py')?.text, 'main draft');
    const action = await w.call('actions.save', {
      projectId: project.id,
      name: 'One-shot',
      kind: 'shell',
      command: 'printf TASK_DONE',
    });
    const task = await w.call('terminal.run', { sessionId: main.id, actionId: action.id });
    for (
      let i = 0;
      i < 100 && w.terminals.runs.find((r) => r.id === task.id)?.state === 'running';
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(w.terminals.runs.find((r) => r.id === task.id)?.state, 'exited');
    const run = await w.terminals.call('run', {
      sessionId: main.id,
      cwd: root,
      file: '/bin/sh',
      args: ['-c', 'printf "running\\n"; sleep 20'],
      name: 'Test',
      command: 'test',
    });
    await w.terminals.call('command', { id: run.id, command: 'detach' });
    assert.equal(w.terminals.runs.find((r) => r.id === run.id)?.state, 'running');
    await w.terminals.call('command', { id: run.id, command: 'attach' });
    await w.terminals.call('command', { id: run.id, command: 'stop' });
    await import('node:fs/promises').then((fs) => fs.rename(root, root + '-moved'));
    await w.call('draft.put', {
      sessionId: main.id,
      path: 'main.py',
      text: 'newest after folder move',
      hash: a.hash,
      version: 2,
    });
    assert.equal(
      (await w.call('files.read', { sessionId: main.id, path: 'main.py' })).text,
      'newest after folder move',
    );
  } finally {
    await w.close();
  }
});

test('command output preserves UTF-8 across chunk boundaries', async () => {
  const text = await command(
    process.execPath,
    [
      '-e',
      'const b=Buffer.from("Привет");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)',
    ],
    { cwd: process.cwd() },
  );
  assert.equal(text, 'Привет');
});
test('twelve terminal parsers keep bounded scrollback memory under sustained output', async () => {
  const runtime = await loadGhosttyRuntime(),
    cores: GhosttyTerminalCore[] = [];
  const theme = {
    foreground: { r: 0, g: 0, b: 0 },
    background: { r: 255, g: 255, b: 255 },
    cursor: { r: 0, g: 0, b: 0 },
  };
  try {
    for (let i = 0; i < 12; i++) {
      const core = await GhosttyTerminalCore.create(180, 45, 8, 18, theme, () => {});
      cores.push(core);
      core.write(('x'.repeat(170) + '\r\n').repeat(8000));
    }
    const before = runtime.memory.buffer.byteLength;
    assert.ok(before < 128 * 1024 * 1024);
    cores[0].write(('y'.repeat(170) + '\r\n').repeat(80000));
    assert.ok(runtime.memory.buffer.byteLength - before <= 16 * 1024 * 1024);
    const warmed = runtime.memory.buffer.byteLength;
    cores[0].write(('z'.repeat(170) + '\r\n').repeat(80000));
    assert.equal(runtime.memory.buffer.byteLength, warmed);
  } finally {
    for (const core of cores) core.dispose();
  }
});
test('an uncertain Git result blocks a fresh operation ID until explicitly reviewed', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {}),
    s = session(root);
  try {
    store.put('operations', { id: 'unknown', sessionId: s.id, phase: 'uncertain', evidence: {} });
    await assert.rejects(
      () =>
        service.act(s, {
          sessionId: s.id,
          operationId: 'another',
          action: 'commit',
          message: 'Duplicate',
        }),
      /previous Git operation/,
    );
    assert.equal(service.acknowledge(s, 'unknown').phase, 'reviewed');
    assert.equal(store.get<any>('operations', 'unknown').evidence.previousPhase, 'uncertain');
  } finally {
    store.close();
  }
});
test('closing hundreds of worktree layouts does not flood the IPC queue', async () => {
  const original = (globalThis as any).window;
  let active = 0,
    peak = 0,
    writes = 0;
  (globalThis as any).window = {
    superfluid: {
      call: async () => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        writes++;
        active--;
      },
    },
  };
  const { useApp, flushLayouts } = await import('../apps/web/src/state');
  const before = useApp.getState().views;
  try {
    useApp.setState({
      views: Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [
          String(i),
          {
            tabs: [],
            active: null,
            expanded: [],
            changes: false,
            surface: null,
            rightTabs: [],
            history: [],
            historyIndex: -1,
            editorViews: {},
          },
        ]),
      ),
    });
    await flushLayouts();
    assert.equal(writes, 200);
    assert.equal(peak, 1);
  } finally {
    useApp.setState({ views: before });
    (globalThis as any).window = original;
  }
});
test('renaming a symlink preserves its target and parallel renames never overwrite a destination', async () => {
  const root = await temp(),
    files = new Files(),
    s = session(root),
    fs = await import('node:fs/promises');
  await writeFile(join(root, 'original.py'), 'original');
  await symlink('original.py', join(root, 'alias.py'));
  await files.rename(s, 'alias.py', 'moved-link.py');
  assert.equal((await fs.lstat(join(root, 'moved-link.py'))).isSymbolicLink(), true);
  assert.equal(await readFile(join(root, 'original.py'), 'utf8'), 'original');
  await writeFile(join(root, 'a.py'), 'a');
  await writeFile(join(root, 'b.py'), 'b');
  const results = await Promise.allSettled([
    files.rename(s, 'a.py', 'target.py'),
    files.rename(s, 'b.py', 'target.py'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await readFile(join(root, 'target.py'), 'utf8'), 'a');
  assert.equal(await readFile(join(root, 'b.py'), 'utf8'), 'b');
});
