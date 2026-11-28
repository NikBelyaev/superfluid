import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Workspace } from '../workspace/Workspace';
import { repository, temp, terminalWorker } from '../../../../tests/fixtures';

test('gopls sees versioned buffers in the destination worktree', async () => {
  const root = await repository();
  const executable = join(await temp(), 'gopls');
  const previous = process.env.SF_GOPLS_PATH;
  await writeFile(
    executable,
    `#!${process.execPath}
let buffer = Buffer.alloc(0), document;
const send = (message) => {
  const json = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write('Content-Length: ' + Buffer.byteLength(json) + '\\r\\n\\r\\n' + json);
};
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf('\\r\\n\\r\\n');
    if (end < 0) return;
    const length = Number(buffer.subarray(0, end).toString().split(': ')[1]);
    if (buffer.length < end + 4 + length) return;
    const { id, method, params } = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    if (method === 'initialize') send({ id, result: { capabilities: {} } });
    if (method === 'textDocument/didOpen') {
      if (params.textDocument.languageId !== 'go') process.exit(1);
      document = params.textDocument;
    }
    if (method === 'textDocument/didChange') {
      document = { ...params.textDocument, text: params.contentChanges[0].text };
    }
    if (method === 'textDocument/didClose') document = undefined;
    if (method === 'textDocument/completion') {
      const items = document?.uri === params.textDocument.uri ? [{ label: document.text }] : [];
      send({ id, result: { items, isIncomplete: false } });
    }
  }
});
`,
    { mode: 0o755 },
  );
  process.env.SF_GOPLS_PATH = executable;
  const workspace = new Workspace(await temp(), () => {}, { terminalWorker });
  try {
    const project = await workspace.projects.add(root);
    const [main] = await workspace.projects.sessions(project.id);
    const side = await workspace.call('session.create', {
      sessionId: main.id,
      branch: 'go-side',
      base: main.branch,
    });
    const sync = (sessionId: string, text: string, version: number) =>
      workspace.call('go.sync', { sessionId, path: 'main.go', version, text });
    const complete = async (sessionId: string, generation: number) =>
      (
        await workspace.call('go.completion', {
          sessionId,
          path: 'main.go',
          position: { line: 0, character: 0 },
          generation,
          requestId: 'completion',
        })
      ).items.map(({ label }) => label);
    const [first, second] = await Promise.all([
      sync(main.id, 'MainBuffer', 1),
      sync(side.id, 'SideBuffer', 1),
    ]);
    assert.equal(await sync(main.id, 'UpdatedBuffer', 3), first);
    await sync(main.id, 'StaleBuffer', 2);
    assert.deepEqual(await complete(main.id, first), ['UpdatedBuffer']);
    assert.deepEqual(await complete(side.id, second), ['SideBuffer']);
    await assert.rejects(complete(main.id, second), /server changed/);
    await workspace.call('go.close', { sessionId: main.id, path: 'main.go' });
    assert.deepEqual(await complete(main.id, first), []);
    await assert.rejects(
      workspace.call('go.sync', {
        sessionId: main.id,
        path: '../outside.go',
        version: 1,
        text: '',
      }),
      /outside the worktree/,
    );
  } finally {
    if (previous === undefined) delete process.env.SF_GOPLS_PATH;
    else process.env.SF_GOPLS_PATH = previous;
    await workspace.close();
  }
});

test('missing gopls reports a Go status without starting a Python server', async () => {
  const root = await repository();
  const previous = process.env.SF_GOPLS_PATH;
  process.env.SF_GOPLS_PATH = join(await temp(), 'missing');
  const events = new EventEmitter();
  const workspace = new Workspace(
    await temp(),
    (event) => {
      if (event.type === 'lsp.status' && event.phase === 'error')
        events.emit('error status', event);
    },
    { terminalWorker },
  );
  try {
    const project = await workspace.projects.add(root);
    const [session] = await workspace.projects.sessions(project.id);
    const failed = once(events, 'error status');
    await assert.rejects(
      workspace.call('go.sync', {
        sessionId: session.id,
        path: 'main.go',
        text: 'package main',
        version: 0,
      }),
      /Install gopls/,
    );
    const [status] = await failed;
    assert.equal(status.server, 'gopls');
    assert.equal(status.sessionId, session.id);
  } finally {
    if (previous === undefined) delete process.env.SF_GOPLS_PATH;
    else process.env.SF_GOPLS_PATH = previous;
    await workspace.close();
  }
});
