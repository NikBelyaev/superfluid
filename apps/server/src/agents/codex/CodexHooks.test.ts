import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile, lstat, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { temp } from '../../../../../tests/fixtures';
import { CodexHooks, codexHookEvents } from './CodexHooks';

test('Codex hooks installation preserves user and other profile hooks and disconnect removes only its own', async () => {
  const root = await temp();
  try {
    const home = join(root, 'home');
    await mkdir(home);
    const target = join(root, 'dotfiles.json');
    const user = { type: 'command', command: 'my-policy' };
    const other = {
      type: 'command',
      statusMessage: 'Superfluid agent status',
      command: "node '/another/profile/hook.cjs'",
    };
    const original = {
      description: 'My hooks',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [user, other] }],
        CustomEvent: [{ hooks: [user] }],
      },
    };
    await writeFile(target, JSON.stringify(original));
    await symlink(target, join(home, 'hooks.json'));
    const hooks = new CodexHooks(join(root, "profile 'one'"), {
      home,
      executable: process.execPath,
    });
    assert.equal((await hooks.status()).enabled, false);
    await hooks.configure(true);
    assert.equal((await hooks.status()).enabled, true);
    const installed = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(installed.hooks.PreToolUse[0], original.hooks.PreToolUse[0]);
    assert.deepEqual(installed.hooks.CustomEvent, original.hooks.CustomEvent);
    for (const event of codexHookEvents)
      assert.equal(installed.hooks[event].at(-1).hooks.length, 1);
    const text = await readFile(target, 'utf8');
    await hooks.configure(true);
    assert.equal(await readFile(target, 'utf8'), text);
    assert.ok((await lstat(join(home, 'hooks.json'))).isSymbolicLink());
    assert.equal((await stat(hooks.helperPath)).mode & 0o777, 0o600);
    await hooks.configure(false);
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), original);
    assert.equal((await hooks.status()).enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex hook setup refuses malformed config without rewriting it', async () => {
  const root = await temp();
  try {
    const home = join(root, 'home');
    await mkdir(home);
    const file = join(home, 'hooks.json');
    const hooks = new CodexHooks(join(root, 'data'), { home });
    for (const text of ['{bad', '{"hooks":[]}', '{"hooks":{"Stop":{}}}']) {
      await writeFile(file, text);
      await assert.rejects(hooks.configure(true));
      assert.equal(await readFile(file, 'utf8'), text);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
