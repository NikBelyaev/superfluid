import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { ChevronRight, FolderOpen, GitBranch, Plus, Search, Settings, Star } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';
import { useUpdates } from '~/state/updates';
import { UpdateButton } from '~/components/settings/UpdateButton';

export function ProjectsPage() {
  const version = useUpdates((s) => s.state?.version);
  const updateAvailable = useUpdates((s) => Boolean(s.state?.availableVersion));
  const projects = useApp((a) => a.projects),
    [query, setQuery] = useState(''),
    [pins, setPins] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('superfluid:pins') || '[]');
      } catch {
        return [];
      }
    });
  const open = () =>
    void desktop
      .chooseProject()
      .then(async (p) => {
        if (p) {
          await useApp.getState().bootstrap();
          await useApp.getState().openProject(p);
        }
      })
      .catch(useApp.getState().fail);
  const filtered = projects
    .filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)));
  return (
    <div className="welcome">
      <aside className="welcome-nav">
        <div className="welcome-brand">
          <span className="fluid-brand-icon">SF</span>
          <div>
            <strong>Superfluid</strong>
            <small>Python workspace</small>
          </div>
        </div>
        <button className="welcome-nav-item active">
          <FolderOpen size={17} />
          Projects
        </button>
        <button className="welcome-nav-item" onClick={open}>
          <Plus size={17} />
          Open a project
        </button>
        <div className="spacer" />
        <UpdateButton />
        <button
          className="welcome-nav-item"
          aria-description={updateAvailable ? 'An update is available.' : undefined}
          onClick={() => useApp.setState({ modal: { kind: 'settings' } })}
        >
          <span className="relative inline-flex">
            <Settings size={17} />
            {updateAvailable && (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
              />
            )}
          </span>
          Settings
        </button>
        <div className="welcome-version">
          Superfluid <span>{version ?? '…'}</span>
        </div>
      </aside>
      <main className="welcome-main">
        <div className="welcome-toolbar">
          <div className="project-search">
            <Search size={15} />
            <input
              aria-label="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
            />
            <kbd>⌘ P</kbd>
          </div>
          <div className="spacer" />
          <button className="button" onClick={open}>
            <FolderOpen size={14} />
            Open
          </button>
          <button className="button" onClick={() => useApp.setState({ modal: { kind: 'clone' } })}>
            <GitBranch size={14} />
            Clone repository
          </button>
        </div>
        <div className="project-list-heading">
          <h1>Your projects</h1>
          <span>
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </span>
        </div>
        <div className="project-list">
          {filtered.map((p, i) => (
            <div className="project-row" key={p.id}>
              <button
                className="project-row-open"
                onClick={() => void useApp.getState().openProject(p)}
              >
                <span className={`project-monogram color-${i % 4}`}>
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="project-info">
                  <strong>{p.name}</strong>
                  <span>{p.path}</span>
                </span>
                <span className="project-time">
                  {new Date(p.lastOpened).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <ChevronRight size={16} />
              </button>
              <button
                className={`pin-button ${pins.includes(p.id) ? 'pinned' : ''}`}
                aria-label={pins.includes(p.id) ? `Unpin ${p.name}` : `Pin ${p.name}`}
                onClick={() => {
                  const next = pins.includes(p.id)
                    ? pins.filter((id) => id !== p.id)
                    : [...pins, p.id];
                  setPins(next);
                  localStorage.setItem('superfluid:pins', JSON.stringify(next));
                }}
              >
                <Star size={14} />
              </button>
            </div>
          ))}
          {!projects.length && (
            <div className="welcome-empty">
              <h2>Open a project</h2>
              <p>Choose a folder or clone a repository to get started.</p>
              <button className="button primary" onClick={open}>
                <FolderOpen size={15} />
                Open project
              </button>
            </div>
          )}
          {projects.length > 0 && !filtered.length && (
            <div className="surface-empty">No matching projects.</div>
          )}
        </div>
      </main>
    </div>
  );
}
