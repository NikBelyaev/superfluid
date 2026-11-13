import type { Location, Surface } from './workspaceView';

export type FileLocation = Omit<Location, 'group' | 'tab'>;

export interface FileSurface {
  kind: 'file';
  path: string;
  preview?: boolean;
  chain?: { id: string; entries: FileLocation[]; index: number; targetIndex: number };
}

export const fileTabKey = (tab: FileSurface) =>
  tab.chain ? `chain:${tab.chain.id}` : `file:${tab.path}`;

export const surfacePaths = (tab: Surface) =>
  tab.kind !== 'file'
    ? []
    : [...new Set(tab.chain ? tab.chain.entries.map((entry) => entry.path) : [tab.path])];

const entryAt = ({
  path,
  line,
  column,
  label,
  symbol,
  symbolKind,
}: FileLocation): FileLocation => ({
  path,
  line,
  column,
  label,
  ...(symbol === undefined ? {} : { symbol }),
  ...(symbolKind === undefined ? {} : { symbolKind }),
});

export function followFile(
  tab: FileSurface,
  origin: FileLocation,
  destination: FileLocation,
): FileSurface {
  const chain = tab.chain ?? {
    id: crypto.randomUUID(),
    entries: [entryAt(origin)],
    index: 0,
    targetIndex: 0,
  };
  const entries = [...chain.entries];
  entries[chain.index] = entryAt(origin);
  let index = entries.findIndex(
    (entry) =>
      entry.path === destination.path &&
      entry.line === destination.line &&
      entry.column === destination.column,
  );
  if (index < 0) {
    entries.push(entryAt(destination));
    index = entries.length - 1;
  }
  if (entries.length > 100) {
    entries.splice(1, entries.length - 100);
    index = entries.length - 1;
  }
  return {
    kind: 'file',
    path: destination.path,
    chain: { ...chain, entries, index, targetIndex: index || chain.targetIndex },
  };
}

export function selectFileLocation(tab: FileSurface, location: FileLocation): FileSurface {
  if (!tab.chain) return { ...tab, path: location.path };
  let index = tab.chain.entries.findIndex(
    (entry) =>
      entry.path === location.path &&
      entry.line === location.line &&
      entry.column === location.column,
  );
  if (index < 0)
    index =
      tab.path === location.path
        ? tab.chain.index
        : tab.chain.entries.findIndex((entry) => entry.path === location.path);
  if (index < 0) return followFile(tab, tab.chain.entries[tab.chain.index]!, location);
  return {
    ...tab,
    path: location.path,
    chain: {
      ...tab.chain,
      index,
      targetIndex: index || tab.chain.targetIndex,
      entries: tab.chain.entries.map((entry, i) => (i === index ? entryAt(location) : entry)),
    },
  };
}

export function mapSurfaceFiles(
  tab: Surface,
  rewrite: (path: string) => string | null,
): Surface | null {
  if (tab.kind !== 'file') return tab;
  if (!tab.chain) {
    const path = rewrite(tab.path);
    return path === null ? null : { ...tab, path };
  }
  const indexed = tab.chain.entries.flatMap((entry, index) => {
    const path = rewrite(entry.path);
    return path === null
      ? []
      : [
          {
            index,
            entry:
              path === entry.path
                ? entry
                : { ...entry, path, label: path.split('/').at(-1) || path },
          },
        ];
  });
  if (!indexed.length) return null;
  const index = Math.max(
    0,
    indexed.findLastIndex((item) => item.index <= tab.chain!.index),
  );
  return {
    ...tab,
    path: indexed[index]!.entry.path,
    chain: {
      ...tab.chain,
      entries: indexed.map((item) => item.entry),
      index,
      targetIndex:
        index ||
        Math.max(
          Math.min(1, indexed.length - 1),
          indexed.findLastIndex((item) => item.index <= tab.chain!.targetIndex),
        ),
    },
  };
}

export function restoreFileSurface(value: {
  path: string;
  preview?: boolean;
  chain?: unknown;
}): FileSurface {
  const file: FileSurface = {
    kind: 'file',
    path: value.path,
    ...(value.preview === undefined ? {} : { preview: value.preview }),
  };
  const chain = value.chain;
  if (
    !chain ||
    typeof chain !== 'object' ||
    !('id' in chain) ||
    typeof chain.id !== 'string' ||
    !chain.id ||
    !('entries' in chain) ||
    !Array.isArray(chain.entries) ||
    !('index' in chain) ||
    !Number.isInteger(chain.index)
  )
    return file;
  const entries: FileLocation[] = chain.entries.slice(0, 100).flatMap((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('path' in entry) ||
      typeof entry.path !== 'string' ||
      !('line' in entry) ||
      typeof entry.line !== 'number' ||
      !Number.isInteger(entry.line) ||
      entry.line < 1 ||
      !('column' in entry) ||
      typeof entry.column !== 'number' ||
      !Number.isInteger(entry.column) ||
      entry.column < 1
    )
      return [];
    return [
      {
        path: entry.path,
        line: entry.line,
        column: entry.column,
        label:
          'label' in entry && typeof entry.label === 'string'
            ? entry.label
            : entry.path.split('/').at(-1) || entry.path,
        ...('symbol' in entry && typeof entry.symbol === 'string' ? { symbol: entry.symbol } : {}),
        ...('symbolKind' in entry && typeof entry.symbolKind === 'number'
          ? { symbolKind: entry.symbolKind }
          : {}),
      },
    ];
  });
  if (!entries.length) return file;
  const index =
    typeof chain.index === 'number' ? Math.max(0, Math.min(chain.index, entries.length - 1)) : 0;
  const targetIndex =
    index ||
    ('targetIndex' in chain &&
    typeof chain.targetIndex === 'number' &&
    Number.isInteger(chain.targetIndex) &&
    chain.targetIndex > 0 &&
    chain.targetIndex < entries.length
      ? chain.targetIndex
      : entries.length - 1);
  return {
    ...file,
    path: entries[index]!.path,
    chain: { id: chain.id, entries, index, targetIndex },
  };
}
