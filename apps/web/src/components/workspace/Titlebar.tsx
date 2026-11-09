import { ChevronDown, Search, Settings2, Settings } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp, openPalette } from '~/state/workspaceStore';
import { WorktreeStrip } from './WorktreeStrip';
import { UpdateButton } from '~/components/settings/UpdateButton';
import { useUpdates } from '~/state/updates';

export function Titlebar({ session }: { session: Session }) {
  const updateAvailable = useUpdates((state) => Boolean(state.state?.availableVersion));
  const projectId = useApp((a) => a.projectId),
    project = useApp((a) => a.projects.find((p) => p.id === projectId));
  return (
    <header className="titlebar">
      <div className="traffic-space" />
      <button className="project-title" onClick={() => void useApp.getState().closeProject()}>
        <span className="project-avatar">{project?.name.slice(0, 2).toUpperCase()}</span>
        {project?.name}
        <ChevronDown size={12} />
      </button>
      <div className="titlebar-divider" />
      <WorktreeStrip session={session} />
      <div className="spacer" />
      <button className="titlebar-search" onClick={() => openPalette('files')}>
        <Search size={13} />
        <span>Go to file</span>
        <kbd>⌘ P</kbd>
      </button>
      <div className="titlebar-tools">
        <button
          className="icon-button"
          title="Python interpreter"
          aria-label="Python interpreter"
          onClick={() => useApp.setState({ modal: { kind: 'interpreter' } })}
        >
          <Settings2 size={16} />
        </button>
        <button
          className="icon-button"
          title="Settings (⌘,)"
          aria-label="Settings"
          aria-description={updateAvailable ? 'An update is available.' : undefined}
          onClick={() => useApp.setState({ modal: { kind: 'settings' } })}
        >
          <span className="relative inline-flex">
            <Settings size={16} />
            {updateAvailable && (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
              />
            )}
          </span>
        </button>
        <UpdateButton compact />
      </div>
    </header>
  );
}
