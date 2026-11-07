import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { TerminalManager } from './TerminalManager';
import type { TerminalFrame } from '@superfluid/contracts';

function deferredFrame() {
  let resolve!: (frame: TerminalFrame) => void;
  const promise = new Promise<TerminalFrame>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

test('completed terminal output can be resized and reattached', async () => {
  const exited = Promise.withResolvers<void>();
  const resized = deferredFrame();
  const manager = new TerminalManager(
    (event) => {
      if (event.type === 'runs' && event.runs.some((run) => run.state === 'exited'))
        exited.resolve();
      if (event.type === 'terminal.frame') resized.resolve(event.frame);
    },
    new URL('../../../../dist/terminal-worker.mjs', import.meta.url),
  );
  try {
    const run = await manager.call('run', {
      sessionId: 'resize-test',
      cwd: tmpdir(),
      file: '/bin/sh',
      args: ['-c', 'printf completed-output'],
      name: 'Resize test',
      command: 'fixture',
    });
    await exited.promise;
    await manager.call('command', {
      id: run.id,
      command: 'resize',
      data: { cols: 72, rows: 20, cellWidth: 8, cellHeight: 18 },
    });
    await manager.call('command', { id: run.id, command: 'attach' });
    const frame = await resized.promise;
    assert.equal(frame.header.cols, 72);
    assert.equal(frame.header.rows, 20);
    assert.ok(frame.rows.some(([, row]) => row.text.includes('completed-output')));
    assert.equal(manager.runs.find((item) => item.id === run.id)?.state, 'exited');
  } finally {
    await manager.close();
  }
});

test('terminal themes validate colors and repaint existing output without restarting the process', async () => {
  const initial = deferredFrame();
  const changed = deferredFrame();
  const restored = deferredFrame();
  const manager = new TerminalManager(
    (event) => {
      if (event.type !== 'terminal.frame') return;
      const frame = event.frame;
      if (frame.rows.some(([, row]) => row.text.includes('settings-theme'))) initial.resolve(frame);
      if (frame.header.background.r === 43) changed.resolve(frame);
      if (frame.header.background.r === 255) restored.resolve(frame);
      void manager.call('command', {
        id: frame.id,
        command: 'ack',
        data: { sequence: frame.sequence, chunk: frame.chunk },
      });
    },
    new URL('../../../../dist/terminal-worker.mjs', import.meta.url),
  );
  try {
    const run = await manager.call('run', {
      sessionId: 'appearance-test',
      cwd: tmpdir(),
      file: '/bin/sh',
      args: ['-c', 'printf settings-theme; cat'],
      name: 'Theme test',
      command: 'fixture',
    });
    await manager.call('command', { id: run.id, command: 'attach' });
    await initial.promise;
    const theme = {
      foreground: { r: 169, g: 183, b: 198 },
      background: { r: 43, g: 43, b: 43 },
      cursor: { r: 187, g: 187, b: 187 },
    };
    await assert.rejects(
      manager.call('command', {
        id: run.id,
        command: 'theme',
        data: { ...theme, background: { r: 999, g: 0, b: 0 } },
      }),
    );
    await manager.call('command', { id: run.id, command: 'theme', data: theme });
    const frame = await changed.promise;
    assert.equal(frame.full, true);
    assert.deepEqual(frame.header.background, theme.background);
    assert.ok(frame.rows.some(([, row]) => row.text.includes('settings-theme')));
    const cell = frame.rows.flatMap(([, row]) => row.cells).find((cell) => cell.text === 's');
    assert.deepEqual(cell?.foreground, theme.foreground);
    await manager.call('command', { id: run.id, command: 'detach' });
    await manager.call('command', {
      id: run.id,
      command: 'theme',
      data: { ...theme, background: { r: 255, g: 255, b: 255 } },
    });
    await manager.call('command', { id: run.id, command: 'attach' });
    assert.equal((await restored.promise).id, run.id);
    assert.equal(manager.runs.find((item) => item.id === run.id)?.state, 'running');
  } finally {
    await manager.close();
  }
});
