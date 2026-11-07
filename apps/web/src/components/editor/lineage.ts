import type { Location } from '~/state/workspaceView';

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
