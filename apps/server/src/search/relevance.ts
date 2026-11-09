import type { SearchHit, SearchType } from '@superfluid/contracts';

type RankedHit = SearchHit & { type?: SearchType };

export function compareSearchHits(query: string) {
  const needle = query.toLowerCase();
  const name = (hit: SearchHit) => (hit.name ?? hit.path.split('/').at(-1)!).toLowerCase();
  const rank = (hit: RankedHit) => {
    if (hit.type === 'text') return 4;
    const value = name(hit);
    if (value === needle || (!hit.name && value.replace(/\.[^.]+$/, '') === needle)) return 0;
    if (value.startsWith(needle)) return 1;
    if (value.includes(needle)) return 2;
    return hit.name !== undefined || hit.path.toLowerCase().includes(needle) ? 3 : 4;
  };
  return (a: RankedHit, b: RankedHit) =>
    rank(a) - rank(b) ||
    name(a).length - name(b).length ||
    name(a).localeCompare(name(b)) ||
    a.path.localeCompare(b.path) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0);
}
