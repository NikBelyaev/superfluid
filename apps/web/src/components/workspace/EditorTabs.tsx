import { useSyncExternalStore } from 'react';
import { Columns2, X } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { useApp, showSurface, closeTabs, surfaceKey } from '~/state/workspaceStore';
import { tabGroup, tabsToClose, type Surface, type TabGroup } from '~/state/workspaceView';
import { subscribe, getRevision, documents, documentPath } from '~/state/editor/Documents';
import { navigateTabs, useActiveTab } from '~/hooks/useTabs';
import { tabDragId } from './tabDrag';
import { WorkspaceTab, surfaceIcons } from './WorkspaceTab';
import { NewSurfaceMenu } from '~/components/surfaces/NewSurfaceMenu';
import { ChainTabMenu } from './ChainTabMenu';
import { surfacePaths } from '~/state/fileChains';
import { useFileGitStatus } from '~/hooks/useFileGitStatus';
import { fileLabelClassName } from '~/components/vcs/fileLabels';
import type { Session } from '@superfluid/contracts';

export function EditorTabs({ session, group = 'main' }: { session: Session; group?: TabGroup }) {
  const view = useApp((a) => a.views[session.id]),
    runs = useApp((a) => a.runs),
    island = useApp((a) => a.island);
  const getGitStatus = useFileGitStatus(session.id);
  const { tabs, active } = tabGroup(view, group);
  const tabStrip = useActiveTab(
    session.id + ':' + group + ':' + (active ? surfaceKey(active) : ''),
  );
  const strip = useDroppable({
    id: `strip:${group}`,
    data: { sessionId: session.id, group, area: 'strip' },
  });
  useSyncExternalStore(subscribe, getRevision);
  const title = (tab: Surface) =>
    tab.kind === 'file'
      ? documentPath(tab.path).split('/').at(-1)!
      : tab.kind === 'files'
        ? 'Files'
        : tab.kind === 'terminal'
          ? (runs.find((run) => run.id === tab.id)?.name ?? 'Terminal')
          : tab.kind === 'diff'
            ? 'Diff'
            : tab.kind === 'browser'
              ? 'Preview'
              : tab.ref
                ? `${tab.ref.provider === 'gitlab' ? '!' : '#'}${tab.ref.number}`
                : tab.number
                  ? '#' + tab.number
                  : 'Requests';
  return (
    <SortableContext
      items={tabs.map((tab) => tabDragId(group, surfaceKey(tab)))}
      strategy={horizontalListSortingStrategy}
    >
      <div ref={strip.setNodeRef} className={group === 'main' ? 'editor-header' : 'surface-header'}>
        <div
          ref={tabStrip}
          className={group === 'main' ? 'editor-tabs' : 'surface-tabs'}
          role="tablist"
          aria-label={group === 'main' ? 'Files' : group === 'bottom' ? 'Terminals' : 'Surfaces'}
          onKeyDown={navigateTabs}
        >
          {tabs.map((tab, index) => {
            const key = surfaceKey(tab),
              selected = !!active && surfaceKey(active) === key,
              Icon = surfaceIcons[tab.kind];
            const dirty = surfacePaths(tab).some(
              (path) => documents.items.get(documents.key(session.id, path))?.dirty,
            );
            const chain = tab.kind === 'file' ? tab.chain : undefined;
            const first = chain?.entries[0],
              last = chain?.entries.at(-1);
            const root = first ? documentPath(first.path).split('/').at(-1) : null;
            const lastTitle = last ? documentPath(last.path).split('/').at(-1)! : title(tab);
            const rootStatus = first ? getGitStatus(first.path) : undefined;
            const lastStatus =
              tab.kind === 'file' ? getGitStatus(last?.path ?? tab.path) : undefined;
            const currentPath = selected && active?.kind === 'file' ? active.path : undefined;
            const rootSelected = !!first && first.path === currentPath;
            const lastSelected = selected && (!last || last.path === currentPath);
            return (
              <WorkspaceTab
                key={key}
                sessionId={session.id}
                group={group}
                tab={tab}
                label={root ? `${root} › ${lastTitle}` : title(tab)}
                selected={selected}
                index={index}
                count={tabs.length}
                close={(scope) =>
                  void closeTabs(
                    session.id,
                    group,
                    tabsToClose(
                      tabGroup(useApp.getState().views[session.id], group).tabs,
                      key,
                      scope,
                    ),
                  )
                }
              >
                {first && (
                  <>
                    <button
                      className="chain-root-link group/file-link"
                      aria-label={`First file: ${root}`}
                      aria-current={rootSelected ? 'location' : undefined}
                      tabIndex={selected ? 0 : -1}
                      title={`${documentPath(first.path)}:${first.line}`}
                      onClick={() =>
                        void useApp
                          .getState()
                          .openFile(first.path, first.line, first.column, true, group, {
                            tabKey: key,
                          })
                      }
                    >
                      <Icon size={13} />
                      <span
                        className={`chain-root tab-label ${fileLabelClassName(rootStatus, rootSelected ? 'default' : 'inactive')}`}
                        data-git-status={rootStatus}
                      >
                        {root}
                      </span>
                    </button>
                    <span className="chain-divider" aria-hidden="true">
                      ›
                    </span>
                  </>
                )}
                <button
                  className={last ? 'chain-last-link group/file-link' : undefined}
                  role="tab"
                  aria-selected={selected}
                  aria-current={chain && lastSelected ? 'location' : undefined}
                  tabIndex={selected ? 0 : -1}
                  aria-controls={
                    group === 'main' ? 'primary-editor-panel' : group + '-surface-panel'
                  }
                  title={
                    last
                      ? `${documentPath(last.path)}:${last.line}`
                      : tab.kind === 'file'
                        ? documentPath(tab.path)
                        : title(tab)
                  }
                  aria-label={title(tab)}
                  aria-description={root ? `Navigation chain from ${root}` : undefined}
                  onClick={() =>
                    last
                      ? void useApp
                          .getState()
                          .openFile(last.path, last.line, last.column, true, group, { tabKey: key })
                      : tab.kind === 'file'
                        ? void useApp
                            .getState()
                            .openFile(tab.path, undefined, undefined, true, group, { tabKey: key })
                        : showSurface(tab, session.id, group)
                  }
                >
                  {!first && (
                    <Icon
                      size={13}
                      className={
                        tab.kind === 'file' && tab.path.endsWith('.py') ? 'python-icon' : ''
                      }
                    />
                  )}
                  <span
                    className={`tab-label ${fileLabelClassName(lastStatus, lastSelected ? 'default' : 'inactive')}`}
                    data-git-status={lastStatus}
                  >
                    {lastTitle}
                  </span>
                  {dirty && <i className="dirty-dot" />}
                </button>
                {tab.kind === 'file' && tab.chain && (
                  <ChainTabMenu
                    sessionId={session.id}
                    group={group}
                    tab={tab}
                    getGitStatus={getGitStatus}
                  />
                )}
                <button
                  className="tab-close"
                  aria-label={root ? `Close navigation chain from ${root}` : `Close ${title(tab)}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void closeTabs(session.id, group, [key])}
                >
                  <X size={12} />
                </button>
              </WorkspaceTab>
            );
          })}
        </div>
        <NewSurfaceMenu session={session} group={group} />
        <div className="spacer" />
        {group === 'main' && (
          <div className="tab-tools">
            <button
              className="icon-button"
              title="Toggle island"
              aria-label="Toggle island"
              aria-pressed={island}
              onClick={() => useApp.setState({ island: !island })}
            >
              <Columns2 size={14} />
            </button>
          </div>
        )}
      </div>
    </SortableContext>
  );
}
