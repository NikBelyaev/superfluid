import { lazy, Suspense, useEffect, useState } from 'react';
import { ChevronRight, FolderOpen, GitBranch, Plus, Search, Star, X } from 'lucide-react';
import { useApp, currentSession } from './state';
import ModalHost, { keySignature } from './Modal';
import Palette from './Palette';
const Workspace = lazy(() => import('./Workspace'));

function Welcome() {
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
    void window.superfluid
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
        <div className="welcome-version">
          Superfluid <span>0.1 alpha</span>
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
export default function App() {
  const project = useApp((a) => a.projectId),
    error = useApp((a) => a.error),
    busy = useApp((a) => a.busy);
  useEffect(() => {
    void useApp.getState().bootstrap();
    return window.superfluid.onEvent((e) => {
      if (e.type === 'runs') useApp.setState({ runs: e.runs });
      else if (e.type === 'operation')
        useApp.setState((a) => ({
          operations: [...a.operations.filter((o) => o.id !== e.operation.id), e.operation],
        }));
      else if (e.type === 'error') useApp.getState().fail(new Error(e.message));
      else if (e.type === 'lsp.status')
        useApp.setState((a) => ({ language: { ...a.language, [e.sessionId]: e.status } }));
      else if (e.type === 'files.changed' && e.sessionId === useApp.getState().sessionId)
        void useApp.getState().refreshGit(e.sessionId);
    });
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!useApp.getState().projectId) {
        if (e.metaKey && e.code === 'KeyP') {
          e.preventDefault();
          document.querySelector<HTMLInputElement>('.project-search input')?.focus();
        }
        return;
      }
      if (e.metaKey && e.code === 'KeyP') {
        e.preventDefault();
        useApp.setState({ palette: e.shiftKey ? 'commands' : 'files' });
        return;
      }
      if (e.metaKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        useApp.setState({ palette: 'search' });
        return;
      }
      if (e.metaKey && e.code === 'KeyS') {
        e.preventDefault();
        void import('./documents').then(({ documents }) => {
          const s = currentSession(),
            v = s ? useApp.getState().views[s.id] : null;
          const focused = documents.focused;
          const doc =
            focused?.session.id === s?.id && !focused?.model.isDisposed()
              ? focused
              : s && v?.active
                ? documents.items.get(documents.key(s.id, v.active))
                : null;
          if (doc) void documents.save(doc).catch(useApp.getState().fail);
        });
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.code === 'Tab') {
        e.preventDefault();
        const a = useApp.getState(),
          i = a.sessions.findIndex((s) => s.id === a.sessionId);
        a.switchSession(
          a.sessions[(i + (e.shiftKey ? -1 : 1) + a.sessions.length) % a.sessions.length]?.id,
        );
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.code === 'Minus') {
        e.preventDefault();
        const s = currentSession();
        if (!s) return;
        const a = useApp.getState(),
          v = a.views[s.id],
          index = v.historyIndex + (e.shiftKey ? 1 : -1),
          item = v.history[index];
        if (item) {
          a.setView({ historyIndex: index });
          void a.openFile(item.path, item.line, item.column, false);
        }
        return;
      }
      const s = currentSession();
      if (s) {
        const action = useApp
          .getState()
          .actions.find(
            (a) => a.projectId === s.projectId && a.shortcut && a.shortcut === keySignature(e),
          );
        if (action) {
          e.preventDefault();
          void import('./Island').then((m) => m.runAction(s, action));
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    const unsubscribe = window.superfluid.onFlush(async () => {
      const { documents } = await import('./documents');
      documents.captureViews();
      await Promise.all([
        documents.recovery.flushAll(),
        import('./state').then((s) => s.flushLayouts()),
      ]);
    });
    return () => {
      window.removeEventListener('keydown', handler, true);
      unsubscribe();
    };
  }, []);
  return (
    <>
      {project ? (
        <Suspense fallback={<div className="app-loading">Opening workspace…</div>}>
          <Workspace />
        </Suspense>
      ) : (
        <Welcome />
      )}
      <ModalHost />
      <Palette />
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
