import { lazy, Suspense } from 'react';
import { useApp, showSurface } from '~/state/workspaceStore';
import ProjectTree from '~/components/sidebar/ProjectTree';
import ProjectDetailsPanel from '~/components/workspace/ProjectDetailsPanel';
import { useDiagnostics } from '~/components/python/useDiagnostics';
import { PanelResizeHandle as Resize } from '~/components/ui/PanelResizeHandle';
import { Titlebar } from './Titlebar';
import { WorktreeStrip } from './WorktreeStrip';
import { ActivityRail } from './ActivityRail';
import { EditorTabs } from './EditorTabs';
import { Statusbar } from './Statusbar';
import RightPanel from '~/components/surfaces/RightPanel';

const Editor = lazy(() => import('~/components/editor/Editor'));

export default function Workspace() {
  const sessions = useApp((a) => a.sessions),
    sessionId = useApp((a) => a.sessionId),
    views = useApp((a) => a.views),
    sidebar = useApp((a) => a.showSidebar),
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
      <Titlebar />
      <WorktreeStrip session={session} />
      <div className="workspace-body">
        <ActivityRail session={session} />
        {sidebar && (
          <>
            <ProjectTree key={session.id} session={session} />
            <Resize variable="--sidebar-width" />
          </>
        )}
        <main className="main-editor">
          <EditorTabs session={session} />
          <Suspense fallback={<div className="surface-empty">Loading editor…</div>}>
            <Editor session={session} path={view.active} />
          </Suspense>
          {island && <ProjectDetailsPanel session={session} />}
        </main>
        {view.surface && (
          <>
            <Resize variable="--right-width" reverse />
            <div
              className="right-group"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const path = e.dataTransfer.getData('application/superfluid-file');
                if (path) showSurface({ kind: 'file', path });
              }}
            >
              <RightPanel key={session.id} session={session} />
            </div>
          </>
        )}
      </div>
      <Statusbar session={session} />
    </div>
  );
}
