import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import {
  Blocks,
  ChevronDown,
  Columns2,
  FileCode2,
  Files,
  GitBranch,
  GitCompareArrows,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { useApp, showSurface } from './state';
import { subscribe, getRevision, documents, monaco } from './documents';
import Tree from './Tree';
import Island from './Island';
import { navigateTabs, useActiveTab } from './tabs';
const Editor = lazy(() => import('./Editor'));
const Surfaces = lazy(() => import('./Surfaces'));

function Resize({ variable, reverse = false }: { variable: string; reverse?: boolean }) {
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-label="Resize panel"
      aria-orientation="vertical"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const value =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) ||
            280;
          document.documentElement.style.setProperty(
            variable,
            Math.max(200, Math.min(650, value + (e.key === 'ArrowRight' ? 10 : -10))) + 'px',
          );
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const initial = e.clientX,
          start =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) ||
            280;
        const move = (event: PointerEvent) =>
          document.documentElement.style.setProperty(
            variable,
            Math.max(200, Math.min(650, start + (event.clientX - initial) * (reverse ? -1 : 1))) +
              'px',
          );
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, { once: true });
      }}
    />
  );
}
export default function Workspace() {
  const projectId = useApp((a) => a.projectId),
    sessions = useApp((a) => a.sessions),
    sessionId = useApp((a) => a.sessionId),
    views = useApp((a) => a.views),
    projects = useApp((a) => a.projects),
    sidebar = useApp((a) => a.showSidebar),
    island = useApp((a) => a.island),
    language = useApp((a) => a.language);
  const session = sessions.find((s) => s.id === sessionId),
    project = projects.find((p) => p.id === projectId);
  const tabStrip = useActiveTab(`${sessionId}:${views[sessionId ?? '']?.active}`);
  useSyncExternalStore(subscribe, getRevision);
  useEffect(
    () =>
      window.superfluid.onEvent((e) => {
        if (e.type === 'diagnostics') {
          const s = useApp.getState().sessions.find((s) => s.id === e.sessionId);
          if (!s) return;
          let uri;
          try {
            uri = monaco.Uri.parse(e.uri);
          } catch {
            return;
          }
          const root = s.path.replace(/\/$/, '') + '/';
          if (!uri.fsPath.startsWith(root)) return;
          const doc = documents.items.get(documents.key(s.id, uri.fsPath.slice(root.length)));
          if (!doc) return;
          monaco.editor.setModelMarkers(
            doc.model,
            'ty',
            e.diagnostics.map((d) => ({
              startLineNumber: d.range.start.line + 1,
              startColumn: d.range.start.character + 1,
              endLineNumber: d.range.end.line + 1,
              endColumn: d.range.end.character + 1,
              message: d.message,
              severity:
                d.severity === 1
                  ? monaco.MarkerSeverity.Error
                  : d.severity === 2
                    ? monaco.MarkerSeverity.Warning
                    : monaco.MarkerSeverity.Info,
              source: 'ty',
              code: String(d.code ?? ''),
            })),
          );
        }
      }),
    [],
  );
  if (!session)
    return (
      <div className="surface-empty">
        No available worktrees. Reconnect the project folder and reopen it.
      </div>
    );
  const view = views[session.id],
    status = useApp.getState().git[session.id];
  return (
    <div className="workspace-shell">
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
      <div className="worktree-strip">
        <span className="strip-label">Worktrees</span>
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`worktree-chip ${s.id === session.id ? 'active' : ''}`}
            aria-pressed={s.id === session.id}
            title={
              s.available ? s.path : 'Directory unavailable. Saved buffers can still be recovered.'
            }
            onClick={() => useApp.getState().switchSession(s.id)}
          >
            <GitBranch size={12} />
            {s.branch || 'Local'}
            {!s.available && ' · missing'}
          </button>
        ))}
        <button
          className="icon-button"
          title="New worktree"
          onClick={() => useApp.setState({ modal: { kind: 'worktree' } })}
        >
          <Plus size={14} />
        </button>
        <div className="spacer" />
        <span className="strip-hint">⌃ ⇥ switch</span>
      </div>
      <div className="workspace-body">
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
        {sidebar && (
          <>
            <Tree key={session.id} session={session} />
            <Resize variable="--sidebar-width" />
          </>
        )}
        <main className="main-editor">
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
                      onDragStart={(e) =>
                        e.dataTransfer.setData('application/superfluid-file', path)
                      }
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
                              active:
                                current.active === path ? (tabs.at(-1) ?? null) : current.active,
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
          <Suspense fallback={<div className="surface-empty">Loading editor…</div>}>
            <Editor session={session} path={view.active} />
          </Suspense>
          {island && <Island session={session} />}
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
              <Suspense fallback={<div className="surface-empty">Loading surface…</div>}>
                <Surfaces key={session.id} session={session} />
              </Suspense>
            </div>
          </>
        )}
      </div>
      <footer className="statusbar">
        <button onClick={() => useApp.getState().setView({ changes: !view.changes })}>
          {status?.files.length ?? 0} changes
        </button>
        <div className="spacer" />
        <span>{language[session.id] || 'Python intelligence starts with a .py file'}</span>
        <span className="status-separator" />
        <button
          title={session.python}
          onClick={() => useApp.setState({ modal: { kind: 'interpreter' } })}
        >
          <span className="python-dot" />
          Python {session.python.includes('.venv') ? '(.venv)' : ''}
        </button>
        <span className="status-separator" />
        <span>UTF-8</span>
        <span>Spaces: 4</span>
        <button title="Show or hide actions" onClick={() => useApp.setState({ island: !island })}>
          <Blocks size={13} />
        </button>
      </footer>
    </div>
  );
}
