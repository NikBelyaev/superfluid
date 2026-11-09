import type { ItemInstance } from '@headless-tree/core';
import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual';

export const TREE_ROW_HEIGHT = 28;

export function stickyTree<T>(items: ItemInstance<T>[]) {
  const ends = Array<number>(items.length).fill(items.length);
  const ancestors: number[] = [];
  for (const [index, item] of items.entries()) {
    while (
      ancestors.length &&
      items[ancestors.at(-1)!].getItemMeta().level >= item.getItemMeta().level
    )
      ends[ancestors.pop()!] = index;
    ancestors.push(index);
  }
  return {
    ends,
    rangeExtractor(range: Range) {
      const indices = new Set(defaultRangeExtractor(range));
      let item = items[range.startIndex]?.getParent();
      while (item && item.getId() !== item.getTree().getConfig().rootItemId) {
        indices.add(item.getItemMeta().index);
        item = item.getParent();
      }
      return [...indices].sort((a, b) => a - b);
    },
  };
}
