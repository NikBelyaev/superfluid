import { useSyncExternalStore } from 'react';
import { Columns2, FileCode2, X } from 'lucide-react';
import { useApp, showSurface } from '~/state/workspaceStore';
import { subscribe, getRevision, documents } from '~/state/editor/Documents';
import { navigateTabs, useActiveTab } from '~/hooks/useTabs';
import type { Session } from '@superfluid/contracts';

export function EditorTabs({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]);
  const tabStrip = useActiveTab(session.id + ':' + view.active);
  useSyncExternalStore(subscribe, getRevision);
  return (
    <div className="editor-header">
      <div
        ref={tabStrip}
        className="editor-tabs"
        role="tablist"
        aria-label="Files"
        onKeyDown={navigateTabs}
      >
        {view.tabs.map((path) => {
          const d = documents.items.get(documents.key(session.id, path));
          return (
            <div key={path} className={`editor-tab ${view.active === path ? 'active' : ''}`}>
              <button
                role="tab"
                aria-selected={view.active === path}
                tabIndex={view.active === path ? 0 : -1}
                aria-controls="primary-editor-panel"
                title={path}
                onClick={() => void useApp.getState().openFile(path)}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/superfluid-file', path)}
              >
                <FileCode2 size={13} className={path.endsWith('.py') ? 'python-icon' : ''} />
                <span>{path.split('/').at(-1)}</span>
                {d?.dirty && <i className="dirty-dot" />}
              </button>
              <button
                className="tab-close"
                aria-label={`Close ${path.split('/').at(-1)}`}
                onClick={async () => {
                  try {
                    await documents.close(session.id, path);
                    const current = useApp.getState().views[session.id];
                    const tabs = current.tabs.filter((p) => p !== path);
                    useApp.getState().setView(
                      {
                        tabs,
                        active: current.active === path ? (tabs.at(-1) ?? null) : current.active,
                      },
                      session.id,
                    );
                  } catch (e) {
                    useApp.getState().fail(e);
                  }
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tab-tools">
        <button
          className="icon-button"
          title="Open current file to the side"
          disabled={!view.active}
          onClick={() => {
            if (view.active) showSurface({ kind: 'file', path: view.active });
          }}
        >
          <Columns2 size={14} />
        </button>
      </div>
    </div>
  );
}
