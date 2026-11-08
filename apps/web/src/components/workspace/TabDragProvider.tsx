import { useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { documents } from '~/state/editor/Documents';
import { useApp } from '~/state/workspaceStore';
import { moveTab, surfaceKey, tabGroup, type Surface } from '~/state/workspaceView';
import { tabDragData } from './tabDrag';
import { TabDragPreview } from './WorkspaceTab';

const collisions: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const inside = pointerWithin(args);
  const strip = inside.find(
    (collision) =>
      args.droppableContainers.find((container) => container.id === collision.id)?.data.current
        ?.area === 'strip',
  );
  if (!strip)
    return inside.filter(
      (collision) =>
        args.droppableContainers.find((container) => container.id === collision.id)?.data.current
          ?.area === 'panel',
    );
  const data = tabDragData(
    args.droppableContainers.find((container) => container.id === strip.id)?.data.current,
  );
  const tabs = args.droppableContainers.filter(
    (container) =>
      container.data.current?.group === data?.group &&
      typeof container.data.current?.key === 'string',
  );
  return tabs.length ? closestCenter({ ...args, droppableContainers: tabs }) : [strip];
};

export function TabDragProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [drag, setDrag] = useState<{
    tab: Surface;
    label: string;
    width: number | undefined;
  } | null>(null);
  const finish = ({ active, over }: DragEndEvent) => {
    setDrag(null);
    const from = tabDragData(active.data.current),
      to = tabDragData(over?.data.current);
    if (!from?.key || !to || from.sessionId !== sessionId || to.sessionId !== sessionId) return;
    if (from.group === to.group && !to.key) return;
    documents.captureViews();
    const app = useApp.getState(),
      view = app.views[sessionId];
    if (!view) return;
    let before = to.key;
    if (to.key) {
      const source = tabGroup(view, from.group).tabs,
        destination = tabGroup(view, to.group).tabs;
      const targetIndex = destination.findIndex((tab) => surfaceKey(tab) === to.key);
      const after =
        from.group === to.group
          ? source.findIndex((tab) => surfaceKey(tab) === from.key) < targetIndex
          : !!active.rect.current.translated &&
            active.rect.current.translated.left + active.rect.current.translated.width / 2 >
              over!.rect.left + over!.rect.width / 2;
      if (after)
        before = destination[targetIndex + 1]
          ? surfaceKey(destination[targetIndex + 1]!)
          : undefined;
    }
    const next = moveTab(view, from.group, to.group, from.key, before);
    if (next !== view) app.setView(next, sessionId);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      onDragStart={({ active }) => {
        const data = tabDragData(active.data.current),
          view = useApp.getState().views[sessionId];
        const tab =
          data?.sessionId === sessionId && view
            ? tabGroup(view, data.group).tabs.find((tab) => surfaceKey(tab) === data.key)
            : undefined;
        if (tab) {
          useApp.setState({ surfaceMenu: null });
          setDrag({
            tab,
            label: data?.label ?? surfaceKey(tab),
            width: active.rect.current.initial?.width,
          });
        }
      }}
      onDragEnd={finish}
      onDragCancel={() => setDrag(null)}
    >
      {children}
      <DragOverlay dropAnimation={null} zIndex={150}>
        {drag && <TabDragPreview {...drag} />}
      </DragOverlay>
    </DndContext>
  );
}
