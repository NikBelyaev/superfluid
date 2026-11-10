import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { AppEvent } from '@superfluid/contracts';
import { session, temp } from '../../../../../tests/fixtures';
import { createCodexFixture } from '../../../../../tests/agents/codexFixture';
import { CodexService } from './CodexService';
import { codexActivity } from './codexActivity';

async function fixture() {
  const root = await temp();
  const first = join(root, 'first'),
    second = join(root, 'second'),
    home = join(root, 'home');
  await Promise.all([mkdir(first), mkdir(second)]);
  const sessions = [
    { ...session(first), id: 'first' },
    { ...session(second), id: 'second' },
  ];
  const events = new EventEmitter();
  const service = new CodexService(
    join(root, 'data'),
    () => sessions,
    (event) => events.emit('event', structuredClone(event)),
    { home },
  );
  await service.ready;
  const wait = (predicate: (event: AppEvent) => boolean) =>
    new Promise<AppEvent>((resolve) => {
      const listener = (event: AppEvent) => {
        if (predicate(event)) {
          events.off('event', listener);
          resolve(event);
        }
      };
      events.on('event', listener);
    });
  const send = async (
    name: string,
    input = {},
    options: { origin?: string; raw?: string } = {},
  ) => {
    const { socketPath } = JSON.parse(
      await readFile(join(root, 'data/codex/connection.json'), 'utf8'),
    );
    const body =
      options.raw ??
      JSON.stringify({
        session_id: '11111111-1111-4111-8111-111111111111',
        cwd: first,
        hook_event_name: name,
        turn_id: 'one',
        ...input,
      });
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path: '/hook',
          method: 'POST',
          headers: {
            ...(options.origin ? { origin: options.origin } : {}),
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let output = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (output += chunk));
          res.on('end', () => resolve({ status: res.statusCode!, body: output }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  };
  return {
    root,
    first,
    second,
    home,
    sessions,
    service,
    send,
    wait,
    async close() {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('Codex hooks install without a shared server and scope activity to canonical worktrees', async () => {
  const f = await fixture();
  let connections = 0;
  const control = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  const socket = join(f.root, 'control.sock');
  await new Promise<void>((resolve) => control.listen(socket, resolve));
  await mkdir(join(f.home, 'app-server-control'), { recursive: true });
  await symlink(socket, join(f.home, 'app-server-control/app-server-control.sock'));
  try {
    await f.service.configure(true);
    assert.equal((await f.send('UserPromptSubmit')).status, 200);
    const agent = f.service.list()[0];
    assert.equal(agent.sessionId, 'first');
    assert.equal(agent.status, 'working');
    assert.equal(agent.runId, 'one');
    const started = agent.startedAt;
    const link = join(f.root, 'linked');
    await symlink(f.first, link);
    await f.send('PreToolUse', { cwd: link, tool_name: 'Read', tool_use_id: 'read' });
    assert.equal(f.service.list()[0].startedAt, started);
    assert.equal(f.service.list()[0].steps[0].label, 'Reading files');
    await f.send('PostToolUse', { tool_name: 'Read', tool_use_id: 'read' });
    assert.equal(f.service.list()[0].steps[0].outcome, 'completed');
    for (let index = 0; index < 12; index++)
      await f.send('PostToolUse', {
        tool_name: 'apply_patch',
        tool_use_id: 'edit-' + index,
        tool_input: { command: '*** Update File: file-' + index + '.py' },
      });
    await f.send('PostToolUse', {
      tool_name: 'apply_patch',
      tool_use_id: 'rename',
      tool_input: {
        command: '*** Update File: old.py\n*** Move to: new.py\n*** Add File: ../../outside.py',
      },
    });
    await f.send('PostToolUse', {
      tool_name: 'Write',
      tool_use_id: 'canonical',
      tool_input: { file_path: join(await realpath(f.first), 'canonical.py') },
    });
    await f.send('PostToolUse', {
      tool_name: 'Write',
      tool_use_id: 'failed',
      tool_failed: true,
      tool_input: { file_path: 'failed.py' },
    });
    assert.equal(f.service.list()[0].steps.length, 8);
    assert.deepEqual(f.service.list()[0].files, [
      ...Array.from({ length: 12 }, (_, index) => 'file-' + index + '.py'),
      'old.py',
      'new.py',
      'canonical.py',
    ]);
    await f.send('Stop', { turn_id: 'stale', last_assistant_message: 'Stale answer' });
    assert.equal(f.service.list()[0].status, 'working');
    assert.equal(f.service.list()[0].message, undefined);
    const hooks = await createCodexFixture(f.home, f.first);
    const response = '**Готово**\n\n' + '漢'.repeat(32768);
    await hooks.send('Stop', { turn_id: 'one', last_assistant_message: response });
    await f.send('SessionEnd');
    assert.equal(f.service.list()[0].status, 'done');
    assert.equal(f.service.list()[0].message, response.slice(0, 32768));
    assert.equal(connections, 0, 'Hooks must not connect to the Codex App Server');
    await f.send('UserPromptSubmit', { turn_id: 'two', cwd: f.second });
    assert.equal(f.service.list()[0].sessionId, 'second');
    assert.equal(f.service.list()[0].runId, 'two');
    assert.deepEqual(f.service.list()[0].steps, []);
    assert.deepEqual(f.service.list()[0].files, []);
    assert.equal(f.service.list()[0].message, undefined);
    await f.send('UserPromptSubmit', { session_id: 'outside', cwd: f.root });
    assert.equal(f.service.list().length, 1);
  } finally {
    await new Promise<void>((resolve) => control.close(() => resolve()));
    await f.close();
  }
});

test('Codex queue uses the CLI with literal messages and never overwrites a newer hook turn', async () => {
  const f = await fixture();
  const cli = await createCodexFixture(f.home, f.first);
  const originalPath = process.env.PATH;
  process.env.PATH = cli.bin + ':' + originalPath;
  try {
    await f.service.configure(true);
    await f.send('UserPromptSubmit');
    await f.send('Stop');
    const agent = f.service.list()[0];
    const input = {
      sessionId: 'first',
      agentId: agent.id,
      message: '--literal $(commands);\n"quotes"',
    };
    await assert.rejects(f.service.queue({ ...input, sessionId: 'second' }), /no longer available/);
    await cli.holdQueue();
    const queued = f.service.queue(input);
    await cli.queueHeld();
    await assert.rejects(f.service.queue(input), /already being queued/);
    await f.send('UserPromptSubmit', { turn_id: 'two' });
    await cli.releaseQueue();
    await queued;
    assert.equal(f.service.list()[0].status, 'working');
    assert.equal(f.service.list()[0].runId, 'two');
    await f.send('Stop', { turn_id: 'two' });
    const completed = f.service.list()[0];
    await assert.rejects(f.service.queue({ ...input, message: 'fail' }), /Unable to queue/);
    assert.equal(f.service.list()[0].status, 'done');
    await f.service.queue(input);
    assert.equal(f.service.list()[0].status, 'queued');
    assert.equal(f.service.list()[0].startedAt, completed.startedAt);
    const waiting = f.service.list()[0];
    for (const name of ['SessionStart', 'SessionEnd', 'Interrupt']) {
      await f.send(name, { turn_id: null });
      assert.deepEqual(f.service.list(), [waiting], name);
    }
    assert.deepEqual(await cli.queueCalls(), [
      {
        args: ['queue', '--thread', agent.threadId, '--message=' + input.message],
        cwd: await realpath(f.first),
        home: f.home,
      },
      {
        args: ['queue', '--thread', agent.threadId, '--message=' + input.message],
        cwd: await realpath(f.first),
        home: f.home,
      },
    ]);
    f.sessions[0].available = false;
    await assert.rejects(f.service.queue(input), /no longer available/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await cli.releaseQueue();
    await f.close();
  }
});

test('Codex session lifecycle does not spawn stopped agents or change settled runs', async () => {
  const f = await fixture();
  try {
    await f.service.configure(true);
    for (const name of ['SessionEnd', 'Interrupt']) {
      await f.send(name, { session_id: 'unseen-' + name, turn_id: null });
      assert.deepEqual(f.service.list(), [], name);
    }
    await f.send('SessionStart', { turn_id: null });
    await f.send('SessionEnd', { turn_id: null });
    assert.deepEqual(f.service.list(), []);
    await f.send('UserPromptSubmit');
    const running = f.service.list()[0];
    await f.send('SessionEnd', { turn_id: null, agent_id: 'lifecycle-only' });
    assert.deepEqual(f.service.list(), [running]);
    await f.send('Stop');
    const done = f.service.list()[0];
    for (const name of ['SessionStart', 'Interrupt', 'SessionEnd']) {
      await f.send(name, { turn_id: null });
      assert.deepEqual(f.service.list(), [done], name);
    }
    await f.send('UserPromptSubmit', { turn_id: 'two' });
    await f.send('Interrupt', { turn_id: 'two' });
    assert.equal(f.service.list()[0].status, 'stopped');
    const stopped = f.service.list()[0];
    await f.send('SessionEnd', { turn_id: null });
    assert.deepEqual(f.service.list(), [stopped]);
    await f.send('UserPromptSubmit', { turn_id: 'three' });
    const next = f.service.list()[0];
    await f.send('SessionEnd', { turn_id: null });
    assert.deepEqual(f.service.list(), [next]);
    await f.send('Interrupt', { turn_id: 'three' });
    assert.equal(f.service.list()[0].status, 'stopped');
  } finally {
    await f.close();
  }
});

test('Codex hook approvals are scoped and disconnect releases them without approving', async () => {
  const f = await fixture();
  try {
    await f.service.configure(true);
    await f.send('UserPromptSubmit');
    const pending = f.wait((event) => event.type === 'codex.agent' && !!event.agent.approval);
    const response = f.send('PermissionRequest', {
      tool_name: 'Bash',
      tool_input: { command: 'git push', description: 'Push the tested branch for review.' },
    });
    await pending;
    const agent = f.service.list()[0];
    assert.equal(agent.approval?.reason, 'Push the tested branch for review.');
    const input = {
      sessionId: 'first',
      agentId: agent.id,
      requestId: agent.approval!.id,
      decision: 'deny' as const,
    };
    assert.throws(() => f.service.respond({ ...input, sessionId: 'second' }), /no longer waiting/);
    f.service.respond(input);
    assert.equal(JSON.parse((await response).body).hookSpecificOutput.decision.behavior, 'deny');
    assert.throws(() => f.service.respond(input), /no longer waiting/);
    const interrupting = f.wait((event) => event.type === 'codex.agent' && !!event.agent.approval);
    const interrupted = f.send('PermissionRequest', { tool_name: 'Bash' });
    await interrupting;
    await f.send('Interrupt');
    assert.deepEqual(JSON.parse((await interrupted).body), {});
    assert.equal(f.service.list()[0].status, 'stopped');
    const next = f.wait((event) => event.type === 'codex.agent' && !!event.agent.approval);
    const released = f.send('PermissionRequest', { tool_name: 'Bash' });
    await next;
    await f.service.configure(false);
    assert.deepEqual(JSON.parse((await released).body), {});
    assert.deepEqual(f.service.list(), []);
  } finally {
    await f.close();
  }
});

test('Codex hooks reject malformed and browser-origin requests without publishing activity', async () => {
  const f = await fixture();
  try {
    await f.service.configure(true);
    assert.equal(
      (await f.send('UserPromptSubmit', {}, { origin: 'https://untrusted.invalid' })).status,
      404,
    );
    assert.equal((await f.send('UserPromptSubmit', {}, { raw: '{bad' })).status, 400);
    assert.equal((await f.send('UserPromptSubmit', { cwd: '../relative' })).status, 400);
    assert.equal((await f.send('UserPromptSubmit', {}, { raw: 'x'.repeat(262145) })).status, 413);
    assert.deepEqual(f.service.list(), []);
    await f.service.configure(false);
    await f.send('UserPromptSubmit');
    assert.deepEqual(f.service.list(), []);
  } finally {
    await f.close();
  }
});

test('activity labels keep readable MCP names and tool categories', () => {
  for (const [tool, input, label] of [
    ['Bash', { command: 'rtk pnpm exec vitest run' }, 'Running tests'],
    ['Bash', { command: 'python3 -m pytest tests/' }, 'Running tests'],
    ['Read', { file_path: 'main.py' }, 'Reading files'],
    ['apply_patch', { command: '*** Update File: ../../secret' }, 'Editing files'],
    ['mcp__codebase_memory_mcp__list_projects', {}, 'List projects'],
    ['mcp__server_with_underscores__getHTTPStatus', {}, 'Get HTTP status'],
  ] as const)
    assert.equal(codexActivity(tool, input, '/workspace').label, label);
  assert.equal(
    codexActivity('mcp__codebase_memory_mcp__list_projects', {}, '/workspace').activity,
    'tool',
  );
});
