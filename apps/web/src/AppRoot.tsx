import { lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';
import DialogHost from '~/components/dialogs/DialogHost';
import CommandPalette from '~/components/command/CommandPalette';
import { ProjectsPage } from '~/components/projects/ProjectsPage';
import { useAppShortcuts } from '~/shortcuts/useAppShortcuts';
import { useWorkspaceEvents } from '~/hooks/useWorkspaceEvents';

const Workspace = lazy(() => import('~/components/workspace/Workspace'));

export default function App() {
  const project = useApp((a) => a.projectId),
    error = useApp((a) => a.error),
    busy = useApp((a) => a.busy);
  useWorkspaceEvents();
  useAppShortcuts();
  return (
    <>
      {project ? (
        <Suspense fallback={<div className="app-loading">Opening workspace…</div>}>
          <Workspace />
        </Suspense>
      ) : (
        <ProjectsPage />
      )}
      <DialogHost />
      <CommandPalette />
      {busy && (
        <div className="busy-note" role="status">
          {busy}
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => useApp.setState({ error: null })}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
