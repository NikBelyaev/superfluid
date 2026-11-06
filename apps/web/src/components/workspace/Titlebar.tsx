import { ChevronDown, Columns2, PanelLeft, Search } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';

export function Titlebar() {
  const projectId = useApp((a) => a.projectId),
    project = useApp((a) => a.projects.find((p) => p.id === projectId)),
    sidebar = useApp((a) => a.showSidebar);
  return (
    <header className="titlebar">
      <div className="traffic-space" />
      <button className="project-title" onClick={() => useApp.setState({ projectId: null })}>
        <span className="project-avatar">{project?.name.slice(0, 2).toUpperCase()}</span>
        {project?.name}
        <ChevronDown size={12} />
      </button>
      <div className="spacer" />
      <button className="titlebar-search" onClick={() => useApp.setState({ palette: 'files' })}>
        <Search size={13} />
        <span>Go to file</span>
        <kbd>⌘ P</kbd>
      </button>
      <button
        className="icon-button"
        title="Toggle project tree"
        onClick={() => useApp.setState({ showSidebar: !sidebar })}
      >
        <PanelLeft size={16} />
      </button>
      <button
        className="icon-button"
        title="Open a surface"
        onClick={() => useApp.setState({ modal: { kind: 'launcher' } })}
      >
        <Columns2 size={16} />
      </button>
    </header>
  );
}
