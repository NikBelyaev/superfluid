import { Files, GitCompareArrows, Search, Settings2 } from 'lucide-react';
import { useApp, showSurface } from '~/state/workspaceStore';
import type { Session } from '@superfluid/contracts';

export function ActivityRail({ session }: { session: Session }) {
  const sidebar = useApp((a) => a.showSidebar),
    view = useApp((a) => a.views[session.id]),
    status = useApp((a) => a.git[session.id]);
  return (
    <nav className="activity-rail" aria-label="Workspace tools">
      <button
        className={`rail-button ${sidebar && !view.changes ? 'active' : ''}`}
        title="Project files"
        onClick={() => {
          useApp.setState({ showSidebar: true });
          useApp.getState().setView({ changes: false });
        }}
      >
        <Files size={19} />
      </button>
      <button
        className="rail-button"
        title="Search project (⌘⇧F)"
        onClick={() => useApp.setState({ palette: 'search' })}
      >
        <Search size={19} />
      </button>
      <button
        className={`rail-button ${view.changes ? 'active' : ''}`}
        title="Changes"
        onClick={() => {
          useApp.setState({ showSidebar: true });
          showSurface({ kind: 'diff' });
        }}
      >
        <GitCompareArrows size={19} />
        {(status?.files.length ?? 0) > 0 && (
          <span className="rail-badge">{status?.files.length}</span>
        )}
      </button>
      <div className="spacer" />
      <button
        className="rail-button"
        title="Python interpreter"
        onClick={() => useApp.setState({ modal: { kind: 'interpreter' } })}
      >
        <Settings2 size={18} />
      </button>
    </nav>
  );
}
