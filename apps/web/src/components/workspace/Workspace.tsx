import { Suspense } from 'react';
import { useApp } from '~/state/workspaceStore';
import ProjectDetailsPanel from '~/components/workspace/ProjectDetailsPanel';
import { useDiagnostics } from '~/components/python/useDiagnostics';
import { PanelResizeHandle as Resize } from '~/components/ui/PanelResizeHandle';
import { Titlebar } from './Titlebar';
import { Statusbar } from './Statusbar';
import { WorkspaceControls } from './WorkspaceControls';
import { TabDragProvider } from './TabDragProvider';
import { rightPanelVisible } from '~/state/workspaceView';
import RightPanel from '~/components/surfaces/RightPanel';

export default function Workspace() {
  const sessions = useApp((a) => a.sessions),
    sessionId = useApp((a) => a.sessionId),
    views = useApp((a) => a.views),
    island = useApp((a) => a.island);
  const session = sessions.find((s) => s.id === sessionId);
  useDiagnostics();
  if (!session)
    return (
      <div className="surface-empty">
        No available worktrees. Reconnect the project folder and reopen it.
      </div>
    );
  const view = views[session.id];
  return (
    <div className="workspace-shell">
      <Titlebar session={session} />
      <TabDragProvider key={session.id} sessionId={session.id}>
        <div className="workspace-body">
          <main className="main-editor">
            <Suspense fallback={<div className="surface-empty">Loading editor…</div>}>
              <RightPanel key={session.id} session={session} group="main" />
            </Suspense>
            {view.bottomSurface && (
              <div className="bottom-group">
                <Suspense fallback={<div className="surface-empty">Loading terminal…</div>}>
                  <RightPanel key={session.id} session={session} group="bottom" />
                </Suspense>
              </div>
            )}
            {island && <ProjectDetailsPanel session={session} />}
          </main>
          {rightPanelVisible(view) && (
            <>
              <Resize variable="--right-width" reverse />
              <div className="right-group">
                <Suspense fallback={<div className="surface-empty">Loading surface…</div>}>
                  <RightPanel key={session.id} session={session} />
                </Suspense>
              </div>
            </>
          )}
          <WorkspaceControls session={session} />
        </div>
      </TabDragProvider>
      <Statusbar session={session} />
    </div>
  );
}
