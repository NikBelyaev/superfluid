import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Workspace } from '../apps/server/src/workspace/Workspace';
import { temp, repository, terminalWorker } from './fixtures';

test('worktrees have independent document recovery and real PTY survives detach', async () => {
  const root = await repository(),
    data = await temp();
  const w = new Workspace(data, () => {}, {
    terminalWorker: terminalWorker,
  });
  try {
    const project = await w.projects.add(root),
      [main] = await w.projects.sessions(project.id);
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
