import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './Store';
import { temp } from '../../../../tests/fixtures';

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
