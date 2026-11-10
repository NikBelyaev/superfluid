import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import type { Duplex } from 'node:stream';

export function t3Thread(path: string, input = {}) {
  const now = new Date().toISOString();
  return {
    id: 'thread-one',
    projectId: 'project',
    title: 'Fix the Python tests',
    modelSelection: { instanceId: 'codex', model: 'test-model' },
    worktreePath: path,
    status: 'running',
    latestRunId: 'run-one',
    activeRunId: 'run-one',
    latestRunStartedAt: now,
    pendingRuntimeRequest: null,
    hasActionableProposedPlan: false,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    ...input,
  };
}

export function t3Step(input = {}) {
  const now = new Date().toISOString();
  return {
    id: 'tool-one',
    runId: 'run-one',
    type: 'command_execution',
    status: 'running',
    title: 'Run command',
    input: 'python3 -m pytest tests/',
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...input,
  };
}

function frame(value: unknown, opcode = 1) {
  const data = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(data.length < 126 ? 2 : 4);
  header[0] = 0x80 | opcode;
  if (header.length === 2) header[1] = data.length;
  else {
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  }
  return Buffer.concat([header, data]);
}

export async function createT3Fixture(path: string) {
  const events = new EventEmitter();
  const threads = new Map([['thread-one', t3Thread(path)]]);
  const details = new Map<string, { turnItems: unknown[]; runtimeRequests: unknown[] }>();
  const peers = new Set<{
    socket: Duplex;
    subscriptions: Map<string, string>;
    send: (id: string, value: unknown) => Promise<void>;
  }>();
  const commands: Record<string, unknown>[] = [];
  let rejectNext = false;
  let sequence = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/.well-known/t3/environment') {
      response.end(
        JSON.stringify({ environmentId: 'fixture-environment', orchestrationProtocolVersion: 2 }),
      );
      return;
    }
    if (request.url === '/oauth/token') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = new URLSearchParams(body);
      assert.equal(input.get('subject_token'), 'fixture-pairing');
      assert.equal(input.get('scope'), 'orchestration:read orchestration:operate');
      response.end(
        JSON.stringify({
          access_token: 'fixture-access',
          token_type: 'Bearer',
          scope: input.get('scope'),
        }),
      );
      return;
    }
    assert.equal(request.headers.authorization, 'Bearer fixture-access');
    assert.equal(request.url, '/api/auth/websocket-ticket');
    response.end(JSON.stringify({ ticket: 'fixture-ticket' }));
  });
  server.on('upgrade', (request, socket) => {
    assert.equal(
      new URL(request.url!, 'http://localhost').searchParams.get('orchestrationProtocol'),
      '2',
    );
    assert.equal(
      new URL(request.url!, 'http://localhost').searchParams.get('wsTicket'),
      'fixture-ticket',
    );
    assert.ok(!request.url!.includes('fixture-access'));
    const accept = createHash('sha1')
      .update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const acks = new Map<string, (() => void)[]>();
    const peer = {
      socket,
      subscriptions: new Map<string, string>(),
      send: (id: string, value: unknown) =>
        new Promise<void>((resolve) => {
          acks.set(id, [...(acks.get(id) ?? []), resolve]);
          socket.write(frame({ _tag: 'Chunk', requestId: id, values: [value] }));
        }),
    };
    peers.add(peer);
    socket.on('error', () => {});
    socket.on('close', () => {
      peers.delete(peer);
      for (const queue of acks.values()) for (const resolve of queue) resolve();
    });
    let buffer = Buffer.alloc(0);
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15,
          masked = !!(buffer[1] & 128);
        let size = buffer[1] & 127,
          offset = 2;
        if (size === 126) {
          if (buffer.length < 4) return;
          size = buffer.readUInt16BE(2);
          offset = 4;
        }
        assert.notEqual(size, 127);
        if (buffer.length < offset + (masked ? 4 : 0) + size) return;
        const mask = buffer.subarray(offset, offset + 4);
        if (masked) offset += 4;
        const payload = Buffer.from(buffer.subarray(offset, offset + size));
        buffer = buffer.subarray(offset + size);
        if (masked)
          for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        if (opcode === 8) {
          socket.end(Buffer.from([0x88, 0]));
          continue;
        }
        if (opcode !== 1) continue;
        const message = JSON.parse(payload.toString());
        if (message._tag === 'Ack') {
          acks.get(message.requestId)?.shift()?.();
          continue;
        }
        if (message._tag === 'Ping') {
          socket.write(frame({ _tag: 'Pong' }));
          continue;
        }
        if (message._tag === 'Interrupt') {
          socket.write(
            frame({ _tag: 'Exit', requestId: message.requestId, exit: { _tag: 'Failure' } }),
          );
          continue;
        }
        if (message.tag === 'orchestration.subscribeShell')
          void peer.send(message.id, {
            kind: 'snapshot',
            snapshot: {
              snapshotSequence: sequence,
              projects: [{ id: 'project', workspaceRoot: path }],
              threads: [...threads.values()],
            },
          });
        else if (message.tag === 'orchestration.subscribeThread') {
          peer.subscriptions.set(message.payload.threadId, message.id);
          void peer.send(message.id, {
            kind: 'snapshot',
            snapshotSequence: sequence,
            projection: details.get(message.payload.threadId) ?? {
              turnItems: [],
              runtimeRequests: [],
            },
          });
        } else if (message.tag === 'orchestration.dispatchCommand') {
          commands.push(message.payload);
          socket.write(
            frame({
              _tag: 'Exit',
              requestId: message.id,
              exit: rejectNext ? { _tag: 'Failure' } : { _tag: 'Success', value: { sequence: 1 } },
            }),
          );
          rejectNext = false;
          events.emit('command', message.payload);
        } else assert.fail(`Unexpected T3 RPC ${message.tag}`);
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    pairingLink: `${origin}/pair#token=fixture-pairing`,
    events,
    threads,
    details,
    commands,
    rejectCommand() {
      rejectNext = true;
    },
    async enrich() {
      await Promise.all(
        [...peers].map((peer) =>
          peer.send('shell', {
            kind: 'snapshot',
            resolvedRepositoryIdentityRoots: [path],
            snapshot: {
              snapshotSequence: sequence + 10,
              projects: [{ id: 'project', workspaceRoot: path }],
              threads: [],
            },
          }),
        ),
      );
    },
    async shell(thread: ReturnType<typeof t3Thread>, at = ++sequence) {
      threads.set(thread.id, thread);
      await Promise.all(
        [...peers].map((peer) =>
          peer.send('shell', {
            kind: 'thread.updated',
            sequence: at,
            location: thread.archivedAt ? 'archive' : 'active',
            thread,
          }),
        ),
      );
    },
    async event(threadId: string, type: string, payload: unknown, at = ++sequence) {
      await Promise.all(
        [...peers].map((peer) =>
          peer.send(peer.subscriptions.get(threadId)!, {
            kind: 'event',
            sequence: at,
            event: { type, payload },
          }),
        ),
      );
    },
    drop() {
      for (const peer of peers) peer.socket.destroy();
    },
    async close() {
      for (const peer of peers) peer.socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
