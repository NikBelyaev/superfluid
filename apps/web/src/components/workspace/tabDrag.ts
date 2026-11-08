import type { DragEvent } from 'react';
import { showSurface } from '~/state/workspaceStore';
import type { TabGroup } from '~/state/workspaceView';

export const tabDragId = (group: TabGroup, key: string) => `tab:${group}:${key}`;

export function tabDragData(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('sessionId' in value) ||
    typeof value.sessionId !== 'string' ||
    !('group' in value) ||
    typeof value.group !== 'string' ||
    !['main', 'right', 'bottom'].includes(value.group)
  )
    return null;
  return {
    sessionId: value.sessionId,
    group: value.group as TabGroup,
    key: 'key' in value && typeof value.key === 'string' ? value.key : undefined,
    label: 'label' in value && typeof value.label === 'string' ? value.label : undefined,
    area: 'area' in value ? value.area : undefined,
  };
}

export function dropFile(event: DragEvent, sessionId: string, group: TabGroup) {
  const path = event.dataTransfer.getData('application/superfluid-file');
  if (!path) return;
  event.preventDefault();
  event.stopPropagation();
  showSurface({ kind: 'file', path }, sessionId, group);
}
