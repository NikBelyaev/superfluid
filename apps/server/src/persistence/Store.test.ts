import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { temp } from '../../../../tests/fixtures';
import { Store } from './Store';

test('recovery drafts never regress to a late version', async () => {
  const store = new Store(await temp());
  try {
    store.draft({ sessionId: 'a', path: 'main.py', text: 'new', hash: 'disk', version: 3 });
    store.draft({ sessionId: 'a', path: 'main.py', text: 'old', hash: 'disk', version: 2 });
    assert.equal(store.drafts('a')[0].text, 'new');
    assert.equal(store.drafts('a')[0].version, 3);
  } finally {
    store.close();
  }
});

test('an older save cannot drop a newer recovery draft', async () => {
  const store = new Store(await temp());
  try {
    store.draft({
      sessionId: 'a',
      path: 'main.py',
      text: 'typed during save',
      hash: 'old',
      version: 4,
    });
    store.dropDraft('a', 'main.py', 3);
    assert.equal(store.drafts('a')[0].version, 4);
    store.dropDraft('a', 'main.py', 4);
    assert.equal(store.drafts('a').length, 0);
  } finally {
    store.close();
  }
});

test('a newer workspace format is refused without modifying the database', async () => {
  const directory = await temp();
  const file = join(directory, 'workspace.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version=999; CREATE TABLE future(value TEXT);');
  db.close();
  assert.throws(() => new Store(directory), /newer version/);
  const check = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 999);
    assert.equal(
      check.prepare("SELECT name FROM sqlite_master WHERE name='projects'").get(),
      undefined,
    );
  } finally {
    check.close();
  }
});
