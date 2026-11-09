import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTree, syncDataLoaderFeature } from '@headless-tree/core';
import { stickyTree } from './stickyTree';

test('adds ancestors to the TanStack range once and bounds sticky rows to their branch', () => {
  const children: Record<string, string[]> = {
    root: ['src', 'main.py'],
    src: ['src/models', 'src/utils'],
    'src/models': Array.from({ length: 100 }, (_, i) => `src/models/${i}.py`),
    'src/utils': ['src/utils/helper.py'],
  };
  const tree = createTree<string>({
    rootItemId: 'root',
    initialState: { expandedItems: ['src', 'src/models', 'src/utils'] },
    getItemName: (item) => item.getItemData(),
    isItemFolder: (item) => item.getId() in children,
    dataLoader: { getItem: (id) => id, getChildren: (id) => children[id] ?? [] },
    features: [syncDataLoaderFeature],
  });
  tree.setMounted(true);
  tree.rebuildTree();
  const items = tree.getItems();
  const layout = stickyTree(items);
  assert.deepEqual(layout.ends.slice(0, 2), [104, 102]);
  const range = { startIndex: 50, endIndex: 59, overscan: 2, count: items.length };
  assert.deepEqual(layout.rangeExtractor(range), [
    0,
    1,
    ...Array.from({ length: 14 }, (_, i) => i + 48),
  ]);
  assert.deepEqual(
    layout.rangeExtractor({ ...range, startIndex: 103, endIndex: 104, overscan: 0 }),
    [0, 102, 103, 104],
  );
  tree.getItemInstance('src').collapse();
  const collapsed = stickyTree(tree.getItems());
  assert.deepEqual(collapsed.ends, [1, 2]);
  assert.deepEqual(
    collapsed.rangeExtractor({ startIndex: 0, endIndex: 1, overscan: 0, count: 2 }),
    [0, 1],
  );
  assert.deepEqual(
    stickyTree([]).rangeExtractor({ startIndex: 0, endIndex: 0, overscan: 0, count: 0 }),
    [],
  );
  tree.setMounted(false);
});
