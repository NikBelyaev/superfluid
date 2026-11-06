import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { FileService } from './FileService';
import { digest } from '../utils/digest';
import { within } from './paths';
import { temp, session } from '../../../../tests/fixtures';

test('file boundaries reject traversal and external symlinks', async () => {
  const root = await temp(),
    outside = await temp();
  await writeFile(join(outside, 'private.py'), 'secret');
  await symlink(outside, join(root, 'escape'));
  await assert.rejects(() => within(root, '../private.py'), /outside/);
  await assert.rejects(() => within(root, 'escape/private.py'), /outside/);
  await assert.rejects(() => within(root, '/etc/passwd'), /inside/);
});

test('save preserves BOM/CRLF and refuses external changes', async () => {
  const root = await temp(),
    files = new FileService(),
    s = session(root);
  const original = '\ufeffprint("a")\r\n';
  await writeFile(join(root, 'main.py'), original);
  const doc = await files.read(s, 'main.py');
  assert.equal(doc.text, original);
  const next = '\ufeffprint("b")\r\n';
  const saved = await files.save(s, 'main.py', next, doc.hash);
  assert.equal(saved.hash, digest(next));
  assert.equal(await readFile(join(root, 'main.py'), 'utf8'), next);
  await writeFile(join(root, 'main.py'), 'external');
  await assert.rejects(() => files.save(s, 'main.py', 'mine', saved.hash), /changed on disk/);
  assert.equal(await readFile(join(root, 'main.py'), 'utf8'), 'external');
});

test('parallel saves with the same baseline cannot overwrite each other', async () => {
  const root = await temp(),
    files = new FileService(),
    s = session(root);
  await writeFile(join(root, 'main.py'), 'initial');
  const doc = await files.read(s, 'main.py');
  const results = await Promise.allSettled([
    files.save(s, 'main.py', 'first', doc.hash),
    files.save(s, 'main.py', 'second', doc.hash),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await readFile(join(root, 'main.py'), 'utf8'), 'first');
});

test('renaming a symlink preserves its target and parallel renames never overwrite a destination', async () => {
  const root = await temp(),
    files = new FileService(),
    s = session(root),
    fs = await import('node:fs/promises');
  await writeFile(join(root, 'original.py'), 'original');
  await symlink('original.py', join(root, 'alias.py'));
  await files.rename(s, 'alias.py', 'moved-link.py');
  assert.equal((await fs.lstat(join(root, 'moved-link.py'))).isSymbolicLink(), true);
  assert.equal(await readFile(join(root, 'original.py'), 'utf8'), 'original');
  await writeFile(join(root, 'a.py'), 'a');
  await writeFile(join(root, 'b.py'), 'b');
  const results = await Promise.allSettled([
    files.rename(s, 'a.py', 'target.py'),
    files.rename(s, 'b.py', 'target.py'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await readFile(join(root, 'target.py'), 'utf8'), 'a');
  assert.equal(await readFile(join(root, 'b.py'), 'utf8'), 'b');
});
