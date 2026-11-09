import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rename, unlink, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { SearchService } from './SearchService';
import { Zoekt } from './Zoekt';
import { FileService } from '../files/FileService';
import { Store } from '../persistence/Store';
import { repository, session, temp } from '../../../../tests/fixtures';

async function finishIndex(search: SearchService) {
  const state = search as unknown as { sessions: Map<string, { building?: Promise<void> }> };
  await Promise.all([...state.sessions.values()].map((session) => session.building));
}

test('Zoekt lists filenames and searches text with an empty system PATH', async () => {
  const root = await repository();
  for (let i = 0; i < 510; i++) await writeFile(join(root, `a-searchable-${i}.py`), '');
  await writeFile(join(root, 'searchable.py'), 'native-only marker\n');
  await writeFile(join(root, '.gitignore'), 'ignored.py\n');
  await writeFile(join(root, 'ignored.py'), 'native-only marker\n');
  const store = new Store(await temp());
  const search = new SearchService(store, new FileService());
  const previous = process.env.PATH;
  process.env.PATH = await temp();
  try {
    assert.deepEqual((await search.files(session(root), 'searchable.py')).hits, [
      { path: 'searchable.py' },
    ]);
    const ranked = await search.files(session(root), 'searchable');
    assert.equal(ranked.hits[0]?.path, 'searchable.py');
    assert.equal(ranked.hits.length, 500);
    assert.equal(ranked.truncated, true);
    assert.equal((await search.files(session(root), 'ignored')).hits.length, 0);
    assert.equal((await search.text(session(root), 'native-only marker')).hits.length, 1);
  } finally {
    process.env.PATH = previous;
    await search.close();
    store.close();
  }
});

test('Zoekt combines disk changes and durable buffers, respects ignores and releases worktree indexes', async (t) => {
  const root = await repository();
  const outside = await temp();
  const data = await temp();
  await writeFile(join(root, 'main.py'), '😀 marker[disk]\r\n');
  await writeFile(join(root, '.gitignore'), 'ignored.py\n');
  await writeFile(join(root, 'ignored.py'), 'marker[ignored]\n');
  await mkdir(join(root, '.worktrees/other'), { recursive: true });
  await writeFile(join(root, '.worktrees/other/private.py'), 'marker[another-worktree]\n');
  await writeFile(join(outside, 'private.py'), 'marker[external]\n');
  await symlink(outside, join(root, 'escape'));
  const store = new Store(data);
  const search = new SearchService(store, new FileService());
  const s = session(root);
  const find = (query: string) => search.text(s, query);
  try {
    const first = await find('marker[');
    assert.deepEqual(first, {
      hits: [{ path: 'main.py', line: 1, column: 4, text: '😀 marker[disk]' }],
      truncated: false,
    });
    await finishIndex(search);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await writeFile(join(root, 'main.py'), 'marker[saved]\n');
    search.changed(s.id, 'main.py', 'change');
    assert.equal((await find('marker[disk]')).hits.length, 0);
    assert.equal((await find('marker[saved]')).hits[0]?.path, 'main.py');
    store.draft({
      sessionId: s.id,
      path: 'main.py',
      text: 'marker[buffer]\n',
      hash: '',
      version: 1,
    });
    assert.equal((await find('marker[saved]')).hits.length, 0);
    assert.equal((await find('marker[buffer]')).hits[0]?.path, 'main.py');
    await unlink(join(root, 'main.py'));
    search.changed(s.id, 'main.py');
    assert.equal((await find('marker[buffer]')).hits[0]?.path, 'main.py');
    store.dropDraft(s.id, 'main.py', 1);
    assert.equal((await find('marker[buffer]')).hits.length, 0);
    await writeFile(join(root, 'new.py'), 'marker[new]\n');
    search.changed(s.id, 'new.py');
    assert.equal((await find('marker[new]')).hits[0]?.path, 'new.py');
    await rename(join(root, 'new.py'), join(root, 'renamed.py'));
    search.changed(s.id, 'new.py');
    search.changed(s.id, 'renamed.py');
    assert.equal((await find('marker[new]')).hits[0]?.path, 'renamed.py');
    await writeFile(join(root, '.gitignore'), 'ignored.py\nrenamed.py\n');
    search.changed(s.id, '.gitignore', 'change');
    assert.equal((await find('marker[new]')).hits.length, 0);
    await writeFile(join(root, 'venv_helpers.py'), 'marker[disk-only]\n');
    search.changed(s.id, 'venv_helpers.py');
    store.draft({
      sessionId: s.id,
      path: 'venv_helpers.py',
      text: 'marker[venv-helper-buffer]\n',
      hash: '',
      version: 1,
    });
    assert.equal((await find('marker[disk-only]')).hits.length, 0);
    assert.equal((await find('marker[venv-helper-buffer]')).hits[0]?.path, 'venv_helpers.py');
    assert.equal((await find('NoSuchText8d71')).hits.length, 0);
    await assert.rejects(find('marker\nnew'), /one line/);
  } finally {
    await search.close();
    store.close();
  }
  assert.deepEqual(await readdir(join(data, 'search')), []);
});

test('a rebuild finishing after another edit retains the latest disk overlay', async (t) => {
  const root = await repository();
  await writeFile(join(root, 'main.py'), 'first\n');
  const store = new Store(await temp());
  const search = new SearchService(store, new FileService());
  const s = session(root);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    assert.equal((await search.text(s, 'first')).hits.length, 1);
    await finishIndex(search);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let built!: () => void;
    const indexed = new Promise<void>((resolve) => {
      built = resolve;
    });
    const request = Zoekt.prototype.request;
    t.mock.method(
      Zoekt.prototype,
      'request',
      async function (this: Zoekt, ...args: Parameters<Zoekt['request']>) {
        const result = await request.apply(this, args);
        if (args[0] === 'index') {
          built();
          await gate;
        }
        return result;
      },
    );
    await writeFile(join(root, 'new.py'), 'second\n');
    search.changed(s.id, 'new.py');
    t.mock.timers.tick(500);
    await indexed;
    assert.equal((await search.text(s, 'second')).hits.length, 1);
    await writeFile(join(root, 'new.py'), 'latest\n');
    search.changed(s.id, 'new.py', 'change');
    release();
    assert.equal((await search.text(s, 'latest')).hits.length, 1);
    assert.equal((await search.text(s, 'second')).hits.length, 0);
  } finally {
    release();
    await search.close();
    store.close();
  }
});

test('search sessions never mix buffers and recover them after eviction and reopening', async () => {
  const roots = await Promise.all([repository(), repository(), repository()]);
  const data = await temp();
  const store = new Store(data);
  const search = new SearchService(store, new FileService());
  const sessions = roots.map((root, i) => ({ ...session(root), id: `session-${i}` }));
  store.draft({
    sessionId: sessions[0].id,
    path: 'main.py',
    text: 'unique-buffer',
    hash: '',
    version: 1,
  });
  try {
    for (const s of sessions) {
      const result = await search.text(s, 'unique-buffer');
      assert.equal(result.hits.length, s.id === sessions[0].id ? 1 : 0);
    }
    assert.equal((await search.text(sessions[0], 'unique-buffer')).hits.length, 1);
  } finally {
    await search.close();
    store.close();
  }
  const reopened = new Store(data);
  const recovered = new SearchService(reopened, new FileService());
  try {
    assert.equal((await recovered.text(sessions[0], 'unique-buffer')).hits.length, 1);
    assert.equal((await recovered.text(sessions[1], 'unique-buffer')).hits.length, 0);
  } finally {
    await recovered.close();
    reopened.close();
  }
});

test('cancelling a cold query releases it while the shared index continues warming', async (t) => {
  const root = await repository();
  const store = new Store(await temp());
  const search = new SearchService(store, new FileService());
  const s = session(root);
  let started!: () => void;
  const indexing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseIndex!: () => void;
  const warming = new Promise<void>((resolve) => {
    releaseIndex = resolve;
  });
  const request = Zoekt.prototype.request;
  t.mock.method(
    Zoekt.prototype,
    'request',
    async function (this: Zoekt, ...args: Parameters<Zoekt['request']>) {
      if (args[0] === 'scan') {
        started();
        await gate;
      }
      const result = await request.apply(this, args);
      if (args[0] === 'index') await warming;
      return result;
    },
  );
  try {
    const first = search.text(s, 'initial', 'cancel-me');
    const rejected = assert.rejects(first, /cancel/i);
    await indexing;
    search.cancel(s.id, 'cancel-me');
    await rejected;
    release();
    assert.equal((await search.text(s, 'initial', 'cancel-me')).hits.length, 1);
  } finally {
    release();
    releaseIndex();
    await search.close();
    store.close();
  }
});

test('failed native startup can retry without leaking a pending query or index directory', async () => {
  const root = await repository();
  const data = await temp();
  const store = new Store(data);
  const search = new SearchService(store, new FileService());
  const s = session(root);
  const binary = process.env.SF_ZOEKT_PATH;
  process.env.SF_ZOEKT_PATH = join(root, 'missing-zoekt');
  try {
    await assert.rejects(search.text(s, 'initial', 'retry'), /ENOENT|stopped/);
    if (binary === undefined) delete process.env.SF_ZOEKT_PATH;
    else process.env.SF_ZOEKT_PATH = binary;
    assert.equal((await search.text(s, 'initial', 'retry')).hits.length, 1);
  } finally {
    if (binary === undefined) delete process.env.SF_ZOEKT_PATH;
    else process.env.SF_ZOEKT_PATH = binary;
    await search.close();
    store.close();
  }
  assert.deepEqual(await readdir(join(data, 'search')), []);
});
