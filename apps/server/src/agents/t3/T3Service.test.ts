import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { session, temp } from '../../../../../tests/fixtures';
import { createT3Fixture, t3Step, t3Thread } from '../../../../../tests/agents/t3Fixture';
import { T3Service } from './T3Service';
import { pairing } from './t3Protocol';

async function fixture() {
  const root = await temp();
  const first = join(root, 'first'),
    second = join(root, 'second');
  await Promise.all([mkdir(first), mkdir(second)]);
  const remote = await createT3Fixture(first);
  const home = join(root, 't3-home');
  const sessions = [
    { ...session(first), id: 'first' },
    { ...session(second), id: 'second' },
  ];
  const events = new EventEmitter();
  const create = () =>
    new T3Service(
      join(root, 'data'),
      () => sessions,
      (event) => {
        if (event.type === 't3' && event.integration.connected) events.emit('connected');
        if (event.type === 't3.agent') events.emit('detail');
        events.emit('event', event);
      },
      { home },
    );
  let service = create();
  const connected = once(events, 'connected');
  const detail = once(events, 'detail');
  await service.connect(remote.pairingLink);
  await connected;
  await detail;
  return {
    root,
    home,
    first,
    second,
    remote,
    events,
    sessions,
    get service() {
      return service;
    },
    async reopen() {
      await service.close();
      const ready = once(events, 'connected');
      service = create();
      await ready;
    },
    async close() {
      await service.close();
      await remote.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('T3 pairing accepts local links and rejects remote hosts and embedded credentials', () => {
  assert.deepEqual(pairing('http://127.0.0.1:3773/pair#token=code'), {
    origin: 'http://127.0.0.1:3773',
    token: 'code',
  });
  assert.deepEqual(pairing('https://t3.codes/pair?host=http%3A%2F%2Flocalhost%3A3773#token=code'), {
    origin: 'http://localhost:3773',
    token: 'code',
  });
  const direct = 'http://127.0.0.1:3773/pair#token=code';
  const hosted = 'https://t3.codes/pair?host=http%3A%2F%2F127.0.0.1%3A3773#token=code';
  assert.deepEqual(pairing('t3code://app/pair#token=code'), {
    origin: undefined,
    token: 'code',
    profile: 'userdata',
  });
  assert.deepEqual(pairing('t3code-dev://app/pair#token=code'), {
    origin: undefined,
    token: 'code',
    profile: 'dev',
  });
  for (const protocol of ['t3code', 't3code-dev', 't3code-nightly'])
    for (const pairingUrl of [direct, hosted])
      assert.deepEqual(pairing(`${protocol}://pair?${new URLSearchParams({ pairingUrl })}`), {
        origin: 'http://127.0.0.1:3773',
        token: 'code',
      });
  for (const link of [
    'http://example.com/pair#token=code',
    'http://user:pass@localhost/pair#token=code',
    'file:///pair#token=code',
    'http://localhost/pair',
    `t3code://threads?${new URLSearchParams({ pairingUrl: direct })}`,
    `t3code://pair/extra?${new URLSearchParams({ pairingUrl: direct })}`,
    `t3code://user:pass@pair?${new URLSearchParams({ pairingUrl: direct })}`,
    `t3code://pair?${new URLSearchParams({ pairingUrl: 'http://user:pass@localhost/pair#token=code' })}`,
    `t3code://pair?${new URLSearchParams({ pairingUrl: 'http://example.com/pair#token=code' })}`,
    't3code://pair',
    't3code://app/pair',
    't3code://user:pass@app/pair#token=code',
    't3code://app/other#token=code',
    't3code://other/pair#token=code',
  ])
    assert.throws(() => pairing(link));
});

test('T3 streams steps to canonical worktrees, rejects stale runs and hides settled or archived conversations', async () => {
  const f = await fixture();
  try {
    const link = join(f.root, 'linked');
    await symlink(f.second, link);
    await f.remote.shell(t3Thread(link, { id: 'thread-two' }));
    await f.remote.event('thread-two', 'turn-item.updated', t3Step());
    assert.equal(f.service.list().find((agent) => agent.id === 'thread-two')?.sessionId, 'second');
    assert.equal(
      f.service.list().find((agent) => agent.id === 'thread-two')?.steps[0].label,
      'Running tests',
    );
    await f.remote.event('thread-one', 'turn-item.updated', t3Step({ input: 'cat main.py' }));
    await f.remote.event(
      'thread-one',
      'turn-item.updated',
      t3Step({ id: 'answer', type: 'assistant_message', text: '**Ready**\n\nTests pass.' }),
    );
    assert.equal(
      f.service.list().find((agent) => agent.id === 'thread-one')?.message,
      '**Ready**\n\nTests pass.',
    );
    await f.remote.enrich();
    assert.equal(f.service.list().length, 2);
    assert.equal(
      f.service.list().find((agent) => agent.id === 'thread-one')?.steps[0].label,
      'Reading files',
    );
    await f.remote.shell(t3Thread(f.first, { latestRunId: 'run-two', activeRunId: 'run-two' }));
    assert.equal(f.service.list().find((agent) => agent.id === 'thread-one')?.message, undefined);
    await f.remote.event(
      'thread-one',
      'turn-item.updated',
      t3Step({ id: 'stale-answer', type: 'assistant_message', text: 'Old run' }),
    );
    assert.equal(f.service.list().find((agent) => agent.id === 'thread-one')?.message, undefined);
    await f.remote.event('thread-one', 'turn-item.updated', t3Step({ status: 'completed' }));
    assert.equal(f.service.list().find((agent) => agent.id === 'thread-one')?.steps.length, 0);
    await f.remote.event('thread-one', 'turn-item.updated', t3Step({ runId: 'run-two' }));
    await f.remote.shell(
      t3Thread(f.first, { status: 'queued', activeRunId: null, latestRunId: 'run-two' }),
    );
    assert.equal(f.service.list().find((agent) => agent.id === 'thread-one')?.status, 'queued');
    await f.remote.shell(
      t3Thread(f.first, { status: 'failed', activeRunId: null, latestRunId: 'run-two' }),
    );
    assert.equal(f.service.list().find((agent) => agent.id === 'thread-one')?.status, 'failed');
    assert.equal(
      f.service.list().find((agent) => agent.id === 'thread-one')?.steps[0].outcome,
      'failed',
    );
    for (const state of [
      { settledOverride: 'settled', settledAt: null },
      { settledOverride: null, settledAt: '2026-11-09T10:01:00Z' },
    ]) {
      await f.remote.shell(t3Thread(f.first, state));
      assert.ok(!f.service.list().some((agent) => agent.id === 'thread-one'));
      await f.reopen();
      assert.ok(!f.service.list().some((agent) => agent.id === 'thread-one'));
      await f.remote.shell(t3Thread(f.first, { settledOverride: 'active' }));
      assert.ok(f.service.list().some((agent) => agent.id === 'thread-one'));
    }
    await f.remote.shell(t3Thread(f.first, { archivedAt: '2026-11-09T10:01:00Z' }));
    assert.ok(!f.service.list().some((agent) => agent.id === 'thread-one'));
    await f.remote.shell(t3Thread(f.first));
    assert.ok(f.service.list().some((agent) => agent.id === 'thread-one'));
    assert.equal((await f.service.status()).connected, true);
  } finally {
    await f.close();
  }
});

test('T3 permissions and messages use the destination conversation and preserve literal message text', async () => {
  const f = await fixture();
  try {
    const request = {
      id: 'approval-one',
      kind: 'command',
      status: 'pending',
      responseCapability: { type: 'live' },
      createdAt: '2026-11-09T10:00:00Z',
    };
    await f.remote.event('thread-one', 'runtime-request.updated', request);
    await f.remote.event(
      'thread-one',
      'turn-item.updated',
      t3Step({
        type: 'approval_request',
        requestId: request.id,
        prompt: 'Allow git push?',
        options: [{ decision: 'accept' }, { decision: 'decline' }],
      }),
    );
    const input = {
      sessionId: 'first',
      agentId: 'thread-one',
      requestId: request.id,
      decision: 'allow' as const,
    };
    assert.equal(f.service.list()[0].approval?.label, 'Allow git push?');
    await assert.rejects(
      f.service.respond({ ...input, sessionId: 'second' }),
      /no longer available/,
    );
    await f.service.respond(input);
    assert.equal(f.remote.commands.at(-1)?.decision, 'accept');
    await f.service.respond({ ...input, decision: 'deny' });
    assert.equal(f.remote.commands.at(-1)?.decision, 'decline');
    await f.remote.event('thread-one', 'runtime-request.updated', {
      ...request,
      status: 'resolved',
    });
    await f.remote.event('thread-one', 'runtime-request.updated', request, 1);
    await assert.rejects(f.service.respond(input), /no longer waiting/);
    const message = '--literal `code` $(commands)\nand "quotes"';
    await assert.rejects(
      f.service.queue({ ...input, sessionId: 'second', message }),
      /no longer available/,
    );
    assert.deepEqual(await f.service.queue({ ...input, message }), { status: 'queued' });
    assert.equal(f.remote.commands.at(-1)?.text, message);
    assert.deepEqual(f.remote.commands.at(-1)?.dispatchMode, { type: 'queue_after_active' });
    f.remote.rejectCommand();
    await assert.rejects(f.service.queue({ ...input, message }), /rejected/);
    f.sessions[0].available = false;
    await assert.rejects(f.service.queue({ ...input, message }), /no longer available/);
  } finally {
    await f.close();
  }
});

test('T3 reconnects from saved credentials without exposing them and disconnect removes the grant locally', async () => {
  const f = await fixture();
  try {
    const runtime = join(f.home, 'userdata', 'server-runtime.json');
    await mkdir(join(f.home, 'userdata'), { recursive: true });
    await writeFile(runtime, JSON.stringify({ pid: process.pid, origin: f.remote.origin }));
    await f.service.disconnect();
    const paired = once(f.events, 'connected');
    await f.service.connect('t3code://app/pair#token=fixture-pairing');
    await paired;
    const file = join(f.root, 'data', 't3', 'connection.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok((await readFile(file, 'utf8')).includes('fixture-access'));
    assert.ok(!JSON.stringify(await f.service.status()).includes('fixture-access'));
    await f.reopen();
    assert.equal(f.service.list()[0].sessionId, 'first');
    const changed = once(f.events, 'event');
    f.remote.drop();
    const [event] = await changed;
    assert.equal(event.integration.connected, false);
    assert.deepEqual(f.service.list(), []);
    await once(f.events, 'connected');
    assert.equal(f.service.list()[0].sessionId, 'first');
    await f.service.disconnect();
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    await rm(runtime);
    await assert.rejects(
      f.service.connect('t3code://app/pair#token=fixture-pairing'),
      /Open T3 Code/,
    );
    for (const state of [
      '{bad',
      JSON.stringify({ pid: 0, origin: f.remote.origin }),
      JSON.stringify({ pid: process.pid, origin: 'https://example.com' }),
      JSON.stringify({ pid: 2147483647, origin: f.remote.origin }),
    ]) {
      await writeFile(runtime, state);
      await assert.rejects(
        f.service.connect('t3code://app/pair#token=fixture-pairing'),
        /Open T3 Code/,
      );
    }
    await assert.rejects(
      f.service.queue({ sessionId: 'first', agentId: 'thread-one', message: 'Hello' }),
      /not connected/,
    );
  } finally {
    await f.close();
  }
});
