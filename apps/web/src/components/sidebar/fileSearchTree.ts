import type { FileEntry, SearchHit } from '@superfluid/contracts';

export function fileSearchTree(hits: readonly Pick<SearchHit, 'path'>[]) {
  const entries = new Map<string, FileEntry>([
    ['', { name: '', path: '', directory: true, symlink: false }],
  ]);
  const children = new Map<string, string[]>([['', []]]);
  const counts = new Map<string, number>();
  const expanded: string[] = [];
  for (const [hitIndex, hit] of hits.entries()) {
    if (entries.has(hit.path)) continue;
    const parts = hit.path.split('/');
    let parent = '';
    for (const [index, name] of parts.entries()) {
      const path = parent ? `${parent}/${name}` : name;
      const directory = index < parts.length - 1;
      if (!entries.has(path)) {
        entries.set(path, { name, path, directory, symlink: false });
        children.get(parent)!.push(path);
        if (directory) children.set(path, []);
      }
      if (directory) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
        if (hitIndex === 0) expanded.push(path);
      }
      parent = path;
    }
  }
  for (const paths of children.values())
    paths.sort((a, b) => {
      const left = entries.get(a)!;
      const right = entries.get(b)!;
      return (
        Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name)
      );
    });
  return { entries, children, expanded, counts };
}

export function expandFileSearch(
  tree: ReturnType<typeof fileSearchTree>,
  expanded: readonly string[],
  requested: readonly string[],
) {
  const previous = new Set(expanded);
  const next = new Set(requested);
  for (const parent of requested) {
    if (previous.has(parent)) continue;
    for (const path of tree.children.keys()) {
      if (path.startsWith(`${parent}/`)) next.add(path);
    }
  }
  return [...next];
}
