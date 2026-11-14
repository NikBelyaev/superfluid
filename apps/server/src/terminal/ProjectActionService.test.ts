import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
