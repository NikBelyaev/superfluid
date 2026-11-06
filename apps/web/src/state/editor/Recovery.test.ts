import test from 'node:test';
import assert from 'node:assert/strict';
import { Recovery } from '~/state/editor/Recovery';

test('recovery flush drains many dirty files with at most two writers', async () => {
  const r = new Recovery(() => {}, 5000, 5000);
  let active = 0,
    peak = 0,
    written = 0;
  for (let i = 0; i < 8; i++)
    r.changed({
      key: String(i),
      version: () => 1,
      text: () => String(i),
      hash: () => '',
      write: async (v) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        written++;
        return { version: v };
      },
    });
  await r.flushAll();
  assert.equal(written, 8);
  assert.equal(peak, 2);
  for (let i = 0; i < 8; i++) r.forget(String(i));
});

test('a new disk baseline is durably checkpointed even at the same edit version', async () => {
  const r = new Recovery(() => {}, 5000, 5000);
  let hash = 'old';
  const saved: string[] = [];
  r.changed({
    key: 'doc',
    version: () => 1,
    text: () => '',
    hash: () => hash,
    write: async (version) => {
      saved.push(hash);
      return { version };
    },
  });
  await r.flushAll();
  hash = 'new';
  await r.rebase('doc');
  assert.deepEqual(saved, ['old', 'new']);
  r.forget('doc');
});

test('continuous edits trigger recovery without waiting for idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let version = 0;
  const writes: { version: number; time: number }[] = [],
    errors: Error[] = [];
  const recovery = new Recovery((e) => errors.push(e), 50, 100);
  const source = {
    key: 'doc',
    version: () => version,
    text: () => String(version),
    hash: () => '',
    write: async (v: number) => {
      writes.push({ version: v, time: Date.now() });
      return { version: v };
    },
  };
  for (let i = 0; i < 20; i++) {
    version++;
    recovery.changed(source);
    t.mock.timers.tick(20);
    for (let n = 0; n < 8; n++) await Promise.resolve();
  }
  await recovery.flushAll();
  assert.ok(writes.length >= 3);
  assert.ok(writes[0].time <= 1100);
  assert.equal(writes.at(-1)!.version, version);
  assert.equal(errors.length, 0);
  recovery.forget('doc');
});

test('an old recovery acknowledgement cannot cover newer edits', async () => {
  let version = 1;
  let resolveFirst!: (v: { version: number }) => void;
  let count = 0;
  const r = new Recovery(() => {}, 5000, 5000);
  const source = {
    key: 'doc',
    version: () => version,
    text: () => String(version),
    hash: () => '',
    write: (v: number) => {
      count++;
      return count === 1
        ? new Promise<{ version: number }>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({ version: v });
    },
  };
  r.changed(source);
  const first = r.flush('doc');
  version = 2;
  r.changed(source);
  resolveFirst({ version: 1 });
  await first;
  assert.equal(r.durable('doc', 2), false);
  await r.flushAll();
  assert.equal(r.durable('doc', 2), true);
  r.forget('doc');
});
