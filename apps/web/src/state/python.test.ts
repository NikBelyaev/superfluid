import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptPythonStatus, onPythonReset, pythonGeneration } from './python';
import { callPython, syncPythonDocument, forgetPythonDocument } from '../rpc/python';
import type { Doc } from './editor/Documents';

test('Python sync shares pending writes and resends only changed buffers or a new server', async () => {
  const sessionId = 'python-sync-test';
  const status = { type: 'lsp.status', sessionId, phase: 'ready', status: 'ready' } as const;
  acceptPythonStatus({ ...status, generation: 1 });
  const original = globalThis.window;
  const writes: { version: number; text: string }[] = [];
  const replies: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  let reads = 0;
  const doc = {
    session: { id: sessionId },
    path: 'main.py',
    version: 1,
    model: {
      isDisposed: () => false,
      getValue: () => {
        reads++;
        return `version = ${doc.version}`;
      },
    },
  } as unknown as Doc;
  globalThis.window = {
    superfluid: {
      call: (_method: string, input: (typeof writes)[number]) => {
        writes.push(input);
        return new Promise((resolve, reject) => replies.push({ resolve, reject }));
      },
    },
  } as unknown as Window & typeof globalThis;
  try {
    const first = syncPythonDocument(doc);
    const concurrent = syncPythonDocument(doc);
    assert.equal(writes.length, 1);
    replies[0].resolve({ generation: 1, value: null });
    await Promise.all([first, concurrent]);
    await syncPythonDocument(doc);
    assert.equal(writes.length, 1);
    assert.equal(reads, 1);

    doc.version = 2;
    const second = syncPythonDocument(doc);
    doc.version = 3;
    const third = syncPythonDocument(doc);
    replies[2].resolve({ generation: 1, value: null });
    await third;
    replies[1].resolve({ generation: 1, value: null });
    await second;
    await syncPythonDocument(doc);
    assert.deepEqual(
      writes.map((w) => w.version),
      [1, 2, 3],
    );

    acceptPythonStatus({ ...status, generation: 2 });
    const failed = syncPythonDocument(doc);
    const rejected = assert.rejects(failed, /offline/);
    replies[3].reject(new Error('offline'));
    await rejected;
    const retry = syncPythonDocument(doc);
    replies[4].resolve({ generation: 2, value: null });
    await retry;
    await syncPythonDocument(doc);
    assert.equal(writes.length, 5);
    assert.equal(reads, 5);

    forgetPythonDocument(doc);
    const reopened = syncPythonDocument(doc);
    replies[5].resolve({ generation: 2, value: null });
    await reopened;
    acceptPythonStatus({ ...status, phase: 'error', generation: 2 });
    const afterError = syncPythonDocument(doc);
    acceptPythonStatus({ ...status, generation: 2 });
    replies[6].resolve({ generation: 2, value: null });
    await afterError;
    await syncPythonDocument(doc);
    assert.equal(writes.length, 7);

    doc.version++;
    const oldServer = syncPythonDocument(doc);
    acceptPythonStatus({ ...status, generation: 3 });
    const newServer = syncPythonDocument(doc);
    replies[8].resolve({ generation: 3, value: null });
    await newServer;
    replies[7].resolve({ generation: 2, value: null });
    await oldServer;
    await syncPythonDocument(doc);
    assert.equal(writes.length, 9);
  } finally {
    for (const reply of replies) reply.resolve({ generation: 2, value: null });
    globalThis.window = original;
  }
});

test('Python requests forward cancellation once and release their listener after completion', async () => {
  const sessionId = 'python-cancellation-test';
  acceptPythonStatus({
    type: 'lsp.status',
    sessionId,
    phase: 'ready',
    status: 'ready',
    generation: 1,
  });
  const original = globalThis.window;
  const calls: { method: string; input: { sessionId: string; requestId?: string } }[] = [];
  let respond!: (value: unknown) => void;
  globalThis.window = {
    superfluid: {
      call: (method: string, input: (typeof calls)[number]['input']) => {
        calls.push({ method, input });
        if (method === 'lsp.cancel') return Promise.resolve(null);
        return new Promise((resolve) => {
          respond = resolve;
        });
      },
    },
  } as unknown as Window & typeof globalThis;
  const input = { sessionId, method: 'textDocument/completion', params: {} } as const;
  const controller = new AbortController();
  try {
    const pending = callPython('lsp.request', input, controller.signal);
    const rejected = assert.rejects(pending, /cancelled/);
    assert.ok(calls[0].input.requestId);
    controller.abort();
    assert.deepEqual(calls[1], {
      method: 'lsp.cancel',
      input: { sessionId, requestId: calls[0].input.requestId },
    });
    respond({ generation: 1, value: 'late result' });
    await rejected;
    await assert.rejects(callPython('lsp.request', input, controller.signal), /cancelled/);
    assert.equal(calls.length, 2);

    let listener: (() => void) | undefined;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (callback: () => void) => {
        listener = callback;
        return {
          dispose: () => {
            listener = undefined;
          },
        };
      },
    };
    const completed = callPython('lsp.request', input, token);
    respond({ generation: 1, value: 'current result' });
    assert.equal(await completed, 'current result');
    assert.equal(listener, undefined);
    assert.equal(calls.length, 3);

    const cancelled = callPython('lsp.request', input, token);
    const ignored = assert.rejects(cancelled, /cancelled/);
    token.isCancellationRequested = true;
    listener!();
    respond({ generation: 1, value: 'late completion' });
    await ignored;
    assert.equal(calls[4].method, 'lsp.cancel');
    assert.equal(calls[4].input.requestId, calls[3].input.requestId);
    assert.equal(listener, undefined);
  } finally {
    respond?.({ generation: 1, value: null });
    globalThis.window = original;
  }
});

test('a late Python result or status cannot replace the new environment', async () => {
  const sessionId = 'python-generation-test';
  const status = { type: 'lsp.status', sessionId, phase: 'ready', status: 'ready' } as const;
  acceptPythonStatus({ ...status, generation: 1 });
  let respond!: (value: { generation: number; value: unknown }) => void;
  const response = new Promise<{ generation: number; value: unknown }>((resolve) => {
    respond = resolve;
  });
  const original = globalThis.window;
  let resets = 0;
  const unsubscribe = onPythonReset((id) => {
    if (id === sessionId) resets++;
  });
  globalThis.window = { superfluid: { call: () => response } } as unknown as Window &
    typeof globalThis;
  try {
    const request = callPython('lsp.request', {
      sessionId,
      method: 'textDocument/hover',
      params: {},
    });
    acceptPythonStatus({ ...status, generation: 2 });
    assert.equal(acceptPythonStatus({ ...status, generation: 1 }), false);
    assert.equal(pythonGeneration(sessionId), 2);
    respond({ generation: 1, value: { contents: 'stale' } });
    await assert.rejects(request, /environment changed/);
    acceptPythonStatus({ ...status, generation: 2 });
    assert.equal(resets, 1);
  } finally {
    unsubscribe();
    globalThis.window = original;
  }
});
