export const TREE_ROW_HEIGHT = 28;

export function treeWindow(
  rows: readonly { depth: number; subtreeEnd: number }[],
  scroll: number,
  height: number,
) {
  const start = Math.max(0, Math.floor(scroll / TREE_ROW_HEIGHT) - 10),
    end = Math.min(rows.length, start + Math.ceil(height / TREE_ROW_HEIGHT) + 20);
  const visible: { index: number; top: number; sticky: boolean }[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index],
      naturalTop = index * TREE_ROW_HEIGHT,
      top = Math.min(scroll + row.depth * TREE_ROW_HEIGHT, (row.subtreeEnd - 1) * TREE_ROW_HEIGHT),
      sticky = row.subtreeEnd > index + 1 && top > naturalTop && top + TREE_ROW_HEIGHT > scroll;
    if (sticky || (index >= start && index < end))
      visible.push({ index, top: sticky ? top : naturalTop, sticky });
  }
  return visible;
}
