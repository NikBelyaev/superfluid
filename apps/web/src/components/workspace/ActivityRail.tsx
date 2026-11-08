import { Files, GitCompareArrows, Search, Settings2, Settings } from 'lucide-react';
import { useApp, showSurface } from '~/state/workspaceStore';
import type { Session } from '@superfluid/contracts';
import { UpdateButton } from '~/components/settings/UpdateButton';
import { useUpdates } from '~/state/updates';

export function ActivityRail({ session }: { session: Session }) {
  const updateAvailable = useUpdates((s) => Boolean(s.state?.availableVersion));
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
      <UpdateButton compact />
      <button
        className="rail-button"
        title="Python interpreter"
        onClick={() => useApp.setState({ modal: { kind: 'interpreter' } })}
      >
        <Settings2 size={18} />
      </button>
      <button
        className="rail-button"
        title="Settings (⌘,)"
        aria-label="Settings"
        aria-description={updateAvailable ? 'An update is available.' : undefined}
        onClick={() => useApp.setState({ modal: { kind: 'settings' } })}
      >
        <span className="relative inline-flex">
          <Settings size={18} />
          {updateAvailable && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
            />
          )}
        </span>
      </button>
    </nav>
  );
}
