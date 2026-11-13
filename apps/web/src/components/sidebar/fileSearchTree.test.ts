import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandFileSearch, fileSearchTree } from './fileSearchTree';

test('groups nested file matches under shared ancestors, with folders first', () => {
  const tree = fileSearchTree([
    { path: 'src/models/z.py' },
    { path: 'src/app.py' },
    { path: 'src/utils/b.py' },
    { path: 'src/models/a.py' },
    { path: 'src/models/a.py' },
    { path: 'src-other/deep/leaf/readme.md' },
    { path: 'main.py' },
  ]);
  assert.deepEqual(tree.children.get(''), ['src', 'src-other', 'main.py']);
  assert.deepEqual(tree.children.get('src'), ['src/models', 'src/utils', 'src/app.py']);
  assert.deepEqual(tree.children.get('src/models'), ['src/models/a.py', 'src/models/z.py']);
  assert.deepEqual(tree.expanded, ['src', 'src/models']);
  assert.deepEqual(
    [...tree.counts],
    [
      ['src', 4],
      ['src/models', 2],
      ['src/utils', 1],
      ['src-other', 1],
      ['src-other/deep', 1],
      ['src-other/deep/leaf', 1],
    ],
  );
  assert.equal(tree.entries.get('src/models')?.directory, true);
  assert.equal(tree.entries.get('src/models/a.py')?.directory, false);
  assert.deepEqual(fileSearchTree([]).children.get(''), []);
  assert.deepEqual(fileSearchTree([]).expanded, []);
  assert.deepEqual(fileSearchTree([{ path: 'main.py' }, { path: 'src/app.py' }]).expanded, []);
  assert.deepEqual(expandFileSearch(tree, [], ['src']), ['src', 'src/models', 'src/utils']);
  const opened = expandFileSearch(tree, tree.expanded, [...tree.expanded, 'src-other']);
  assert.deepEqual(opened, [
    'src',
    'src/models',
    'src-other',
    'src-other/deep',
    'src-other/deep/leaf',
  ]);
  assert.deepEqual(expandFileSearch(tree, opened, tree.expanded), tree.expanded);
});
