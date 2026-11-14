import test from 'node:test';
import assert from 'node:assert/strict';
import { serverSignalTargets, serverSnapshot } from './TerminalServers';

const terminals = [
  { terminalId: 'one', sessionId: 'first', pid: 10 },
  { terminalId: 'two', sessionId: 'second', pid: 20 },
];
const processes = `10 1 10 /bin/sh\n11 10 11 /usr/bin/node\n12 11 11 /usr/bin/node\n20 1 20 /bin/sh\n21 20 21 /usr/bin/python\n30 1 30 /usr/bin/node`;

test('listener discovery attributes nested processes, deduplicates IPv6 and ignores unrelated or external listeners', () => {
  const snapshot = serverSnapshot(
    processes,
    `p12\ncnode\nn127.0.0.1:5173\nn[::1]:5173\nn*:5174\np21\ncPython\nn0.0.0.0:8000\np30\ncnode\nn*:9000\np11\ncnode\nn192.168.1.2:5000\nn*:0\nn*:65536`,
    terminals,
  );
  assert.deepEqual(
    snapshot.servers.map(({ terminalId, sessionId, port }) => ({ terminalId, sessionId, port })),
    [
      { terminalId: 'one', sessionId: 'first', port: 5173 },
      { terminalId: 'one', sessionId: 'first', port: 5174 },
      { terminalId: 'two', sessionId: 'second', port: 8000 },
    ],
  );
  assert.deepEqual(serverSnapshot(processes, 'p30\ncnobody\nn*:9000', terminals).servers, []);
  assert.deepEqual(serverSnapshot(processes, 'p12\ncnode\nn*:5173', []).servers, []);
  for (const [previewUrl, expected] of [
    ['http://localhost:5173/admin', 'http://localhost:5173/admin'],
    ['https://localhost:5173/', 'https://localhost:5173/'],
    ['https://example.test:5173/', 'http://localhost:5173'],
    ['http://localhost:8000/', 'http://localhost:5173'],
  ]) {
    const configured = serverSnapshot(processes, 'p12\ncnode\nn*:5173', [
      { ...terminals[0]!, previewUrl },
    ]);
    assert.equal(configured.servers[0]?.url, expected);
  }
});

test('server stopping guards shells and unrelated group members while preserving job-group signals', () => {
  const snapshot = serverSnapshot(processes, 'p11\ncnode\nn*:5173', terminals);
  const [server] = snapshot.servers;
  assert.deepEqual(serverSignalTargets(snapshot, server), [-11]);
  const shared = serverSnapshot(
    processes.replace('11 10 11', '11 10 10').replace('12 11 11', '12 11 10'),
    'p11\ncnode\nn*:5173',
    terminals,
  );
  assert.deepEqual(serverSignalTargets(shared, server), [12, 11]);
  const unrelated = serverSnapshot(
    processes.replace('30 1 30', '30 1 11'),
    'p11\ncnode\nn*:5173',
    terminals,
  );
  assert.deepEqual(serverSignalTargets(unrelated, server), [12, 11]);
  assert.deepEqual(serverSignalTargets(snapshot, { ...server, terminalId: 'two' }), []);
  assert.deepEqual(serverSignalTargets(snapshot, { ...server, sessionId: 'second' }), []);
  const direct = serverSnapshot('11 1 11 node', 'p11\ncnode\nn*:5173', [
    { terminalId: 'direct', sessionId: 'first', pid: 11 },
  ]);
  assert.deepEqual(serverSignalTargets(direct, direct.servers[0]!), [-11]);
});
