import type { Location } from '~/state/workspaceView';

export function recordLocation(history: Location[], historyIndex: number, location: Location) {
  const current = history[historyIndex];
  if (
    current?.path === location.path &&
    current.line === location.line &&
    current.column === location.column &&
    (current.group ?? 'main') === (location.group ?? 'main') &&
    current.tab === location.tab
  )
    return { history, historyIndex };
  const next = [...history.slice(0, historyIndex + 1), location].slice(-100);
  return { history: next, historyIndex: next.length - 1 };
}

export function removeLineageEntry(history: Location[], historyIndex: number, index: number) {
  const remaining = history.filter((_, i) => i !== index);
  return {
    history: remaining,
    historyIndex: Math.min(
      remaining.length - 1,
      Math.max(0, historyIndex - (index <= historyIndex ? 1 : 0)),
    ),
  };
}
