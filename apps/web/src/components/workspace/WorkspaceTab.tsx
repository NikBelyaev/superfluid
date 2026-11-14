import type { ReactNode } from 'react';
import { useDndContext } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ContextMenu } from '@base-ui/react/context-menu';
import {
  FileCode2,
  Files,
  GitCompareArrows,
  GitPullRequest,
  Globe,
  TerminalSquare,
} from 'lucide-react';
import { surfaceKey, type Surface, type TabGroup, type TabCloseScope } from '~/state/workspaceView';
import { useApp } from '~/state/workspaceStore';
import { desktop } from '~/rpc/desktop';
import { tabDragId } from './tabDrag';

export const surfaceIcons = {
  file: FileCode2,
  files: Files,
  diff: GitCompareArrows,
  pr: GitPullRequest,
  browser: Globe,
  terminal: TerminalSquare,
};

export function WorkspaceTab({
  sessionId,
  group,
  tab,
  label,
  selected,
  index,
  count,
  close,
  children,
}: {
  sessionId: string;
  group: TabGroup;
  tab: Surface;
  label: string;
  selected: boolean;
  index: number;
  count: number;
  close: (scope: TabCloseScope) => void;
  children: ReactNode;
}) {
  const key = surfaceKey(tab);
  const menu = useApp((state) => state.surfaceMenu);
  const terminal = useApp((state) =>
    tab.kind === 'terminal' ? state.runs.find((run) => run.id === tab.id) : undefined,
  );
  const open =
    menu?.sessionId === sessionId &&
    menu.group === group &&
    menu.tabKey === key &&
    menu.kind !== 'chain';
  const { listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: tabDragId(group, key),
    data: { sessionId, group, key, label },
  });
  const { active } = useDndContext();
  return (
    <ContextMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (next) useApp.setState({ surfaceMenu: { sessionId, group, tabKey: key } });
        else if (open) useApp.setState({ surfaceMenu: null });
      }}
    >
      <ContextMenu.Trigger
        ref={setNodeRef}
        {...listeners}
        data-tab-key={key}
        data-dragging={isDragging || undefined}
        data-cross-drop={(isOver && active?.data.current?.group !== group) || undefined}
        className={`${group === 'main' ? 'editor-tab' : 'surface-tab'} ${selected ? 'active' : ''} ${tab.kind === 'file' && tab.chain ? '' : 'group/file-link'}`}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
          opacity: isDragging ? 0 : undefined,
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="menu-positioner">
          <ContextMenu.Popup className="small-menu tab-context-menu" aria-label="Tab actions">
            {tab.kind === 'terminal' && (
              <>
                <ContextMenu.Item
                  onClick={() =>
                    useApp.setState({
                      modal: { kind: 'terminal-name', id: tab.id, name: terminal?.name ?? label },
                    })
                  }
                >
                  Rename terminal
                </ContextMenu.Item>
                <ContextMenu.Item
                  disabled={terminal?.state !== 'running'}
                  onClick={() =>
                    void desktop
                      .call('terminal.command', { id: tab.id, command: 'stop' })
                      .catch(useApp.getState().fail)
                  }
                >
                  Stop terminal
                </ContextMenu.Item>
              </>
            )}
            <ContextMenu.Item onClick={() => close('this')}>Close</ContextMenu.Item>
            <ContextMenu.Item disabled={count < 2} onClick={() => close('others')}>
              Close others
            </ContextMenu.Item>
            <ContextMenu.Item disabled={index === 0} onClick={() => close('left')}>
              Close to the left
            </ContextMenu.Item>
            <ContextMenu.Item disabled={index === count - 1} onClick={() => close('right')}>
              Close to the right
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => close('all')}>Close all</ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function TabDragPreview({
  tab,
  label,
  width,
}: {
  tab: Surface;
  label: string;
  width: number | undefined;
}) {
  const Icon = surfaceIcons[tab.kind];
  return (
    <div className="tab-drag-preview" style={{ width }}>
      <Icon size={14} />
      <span>{label}</span>
    </div>
  );
}
