import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { TerminalManager } from './TerminalManager';
import type { TerminalFrame, TerminalServer } from '@superfluid/contracts';

function deferredFrame() {
  let resolve!: (frame: TerminalFrame) => void;
  const promise = new Promise<TerminalFrame>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

test('completed terminal output can be resized and reattached', async () => {
  let resolveExited!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });
  const resized = deferredFrame();
  const manager = new TerminalManager(
    (event) => {
      if (event.type === 'runs' && event.runs.some((run) => run.state === 'exited'))
        resolveExited();
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
    await exited;
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

test('the server list excludes shells and unrelated listeners, and stopping preserves the shell', async () => {
  const { createServer } = await import('node:net');
  const { once } = await import('node:events');
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { temp } = await import('../../../../tests/fixtures');
  const root = await temp();
  const script = join(root, 'server.cjs');
  await writeFile(
    script,
    `if (process.argv.includes('--ignore-term')) process.on('SIGTERM', () => {}); const server = require('node:http').createServer((q,s) => s.end('fixture')); server.listen(0,'127.0.0.1',()=>console.log('SERVER_PORT='+server.address().port));`,
  );
  const foreign = createServer();
  foreign.listen(0, '127.0.0.1');
  await once(foreign, 'listening');
  const ports = new Map<string, (port: number) => void>();
  const manager = new TerminalManager(
    (event) => {
      if (event.type !== 'terminal.frame') return;
      for (const [, row] of event.frame.rows) {
        const match = /SERVER_PORT=(\d+)/.exec(row.text);
        if (match) ports.get(event.frame.id)?.(Number(match[1]));
      }
      void manager.call('command', {
        id: event.frame.id,
        command: 'ack',
        data: { sequence: event.frame.sequence, chunk: event.frame.chunk },
      });
    },
    new URL('../../../../dist/terminal-worker.mjs', import.meta.url),
  );
  try {
    const shell = await manager.call('run', {
      sessionId: 'first',
      cwd: root,
      file: '/bin/sh',
      args: ['-i'],
      name: 'Shell',
      command: '',
    });
    assert.deepEqual(await manager.call('servers', {}), []);
    const firstPort = new Promise<number>((resolve) => ports.set(shell.id, resolve));
    await manager.call('command', { id: shell.id, command: 'attach' });
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
    await manager.call('command', {
      id: shell.id,
      command: 'text',
      data: `${quote(process.execPath)} ${quote(script)} --ignore-term`,
    });
    await manager.call('command', {
      id: shell.id,
      command: 'key',
      data: { key: 'Enter', code: 'Enter' },
    });
    const port = await firstPort;
    const other = await manager.call('run', {
      sessionId: 'second',
      cwd: root,
      file: process.execPath,
      args: [script],
      name: 'Other server',
      command: '',
    });
    const otherPort = new Promise<number>((resolve) => ports.set(other.id, resolve));
    await manager.call('command', { id: other.id, command: 'attach' });
    const secondPort = await otherPort;
    const servers: TerminalServer[] = await manager.call('servers', {});
    assert.deepEqual(
      servers.map((server) => server.port).sort((a, b) => a - b),
      [port, secondPort].sort((a, b) => a - b),
    );
    const server = servers.find((server) => server.terminalId === shell.id)!;
    assert.equal(server.sessionId, 'first');
    await assert.rejects(manager.call('stopServer', { ...server, sessionId: 'second' }), /session/);
    assert.equal((await manager.call('servers', {})).length, 2);
    await manager.call('stopServer', server);
    await assert.rejects(manager.call('stopServer', server), /no longer/);
    assert.equal(manager.runs.find((run) => run.id === shell.id)?.state, 'running');
    assert.deepEqual(
      (await manager.call('servers', {})).map((server: { port: number }) => server.port),
      [secondPort],
    );
  } finally {
    try {
      await manager.close();
    } finally {
      foreign.close();
    }
  }
});
