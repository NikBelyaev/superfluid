import {
  ChevronDown,
  Play,
  Plus,
  TerminalSquare,
  GitBranch,
  GitCompareArrows,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Square,
  Settings2,
  GitPullRequest,
  ChevronUp,
  Globe,
} from 'lucide-react';
import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { useShallow } from 'zustand/react/shallow';
import type { Action, Session } from '../../../packages/contracts';
import { showSurface, useApp } from './state';

export async function runAction(session: Session, action?: Action) {
  try {
    const run = await window.superfluid.call('terminal.run', {
      sessionId: session.id,
      ...(action ? { actionId: action.id } : { name: 'Terminal' }),
    });
    showSurface({ kind: 'terminal', id: run.id }, session.id);
  } catch (e) {
    useApp.getState().fail(e);
  }
}
export default function Island({ session }: { session: Session }) {
  const actions = useApp(
      useShallow((a) => a.actions.filter((x) => x.projectId === session.projectId)),
    ),
    runs = useApp(useShallow((a) => a.runs.filter((x) => x.sessionId === session.id))),
    status = useApp((a) => a.git[session.id]),
    view = useApp((a) => a.views[session.id]);
  const [collapsed, setCollapsed] = useState(false);
  const operation = useApp((a) => a.operations.filter((x) => x.sessionId === session.id).at(-1));
  const go = (direction: number) => {
    const index = view.historyIndex + direction,
      target = view.history[index];
    if (!target) return;
    useApp.getState().setView({ historyIndex: index });
    void useApp.getState().openFile(target.path, target.line, target.column, false);
  };
  return (
    <div className={`island ${collapsed ? 'collapsed' : ''}`} aria-label="Project actions">
      {collapsed && (
        <button
          className="island-heading island-expand"
          title="Expand actions"
          aria-label="Expand actions"
          onClick={() => setCollapsed(false)}
        >
          <GitBranch size={16} />
          <strong>{session.branch || 'Local workspace'}</strong>
          <ChevronUp size={16} />
        </button>
      )}
      {!collapsed && (
        <>
          <div className="island-section">
            <div className="section-label">
              <span>Scripts</span>
              <div>
                <button
                  className="icon-button"
                  title="Add project action"
                  onClick={() => useApp.setState({ modal: { kind: 'action' } })}
                >
                  <Plus size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Collapse actions"
                  onClick={() => setCollapsed(true)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            </div>
            <div className="action-list">
              {actions.length ? (
                actions.map((action) => (
                  <div className="action-row" key={action.id}>
                    <button
                      className="island-row"
                      title={action.name}
                      onClick={() => void runAction(session, action)}
                    >
                      <Play size={13} />
                      <span>{action.name}</span>
                      <kbd>{action.shortcut.replace('Meta', '⌘').replace('Key', '')}</kbd>
                    </button>
                    <button
                      className="icon-button quiet"
                      title={`Edit ${action.name}`}
                      onClick={() => useApp.setState({ modal: { kind: 'action', action } })}
                    >
                      <Settings2 size={12} />
                    </button>
                  </div>
                ))
              ) : (
                <button
                  className="island-row muted"
                  onClick={() => useApp.setState({ modal: { kind: 'action' } })}
                >
                  <Plus size={14} />
                  <span>Add project action</span>
                </button>
              )}
            </div>
          </div>
          <div className="island-scroll">
            <div className="island-section">
              <button
                className="island-row branch-row"
                title={status?.branch || session.branch || 'Initialize Git'}
                onClick={() => {
                  if (status?.repo) useApp.setState({ modal: { kind: 'worktree' } });
                  else
                    void window.superfluid
                      .call('git.init', { sessionId: session.id })
                      .then(() => {
                        const app = useApp.getState(),
                          project = app.projects.find((p) => p.id === session.projectId);
                        if (project) return app.openProject(project);
                      })
                      .catch(useApp.getState().fail);
                }}
              >
                <GitBranch size={14} />
                <span>{status?.branch || session.branch || 'Initialize Git'}</span>
                <ChevronDown size={13} />
              </button>
              <div className="split-action">
                <button
                  className="island-row"
                  disabled={!status?.repo}
                  onClick={() => useApp.setState({ modal: { kind: 'git', action: 'publish' } })}
                >
                  <GitPullRequest size={14} />
                  <span>Commit, push & PR</span>
                </button>
                <Menu.Root>
                  <Menu.Trigger
                    className="split-menu-trigger"
                    aria-label="Individual Git actions"
                    disabled={!status?.repo}
                  >
                    <ChevronDown size={16} />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
                      <Menu.Popup className="small-menu">
                        {(['commit', 'push', 'pr'] as const).map((action) => (
                          <Menu.Item
                            key={action}
                            onClick={() => useApp.setState({ modal: { kind: 'git', action } })}
                          >
                            {action === 'pr'
                              ? 'Create PR'
                              : action[0].toUpperCase() + action.slice(1)}
                          </Menu.Item>
                        ))}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </div>
              <button className="island-row" onClick={() => showSurface({ kind: 'diff' })}>
                <GitCompareArrows size={14} />
                <span>Changes</span>
                <span className="change-count">{status?.files.length ?? 0} files</span>
              </button>
              {operation && operation.phase !== 'completed' && (
                <div className={`operation-state ${operation.error ? 'error-text' : ''}`}>
                  {operation.phase.replaceAll('-', ' ')}
                  {operation.error && ' · ' + operation.error}
                  {[
                    'committing',
                    'committed',
                    'pushing',
                    'pushed',
                    'creating-pr',
                    'uncertain',
                    'needs-review',
                  ].includes(operation.phase) && (
                    <button
                      className="text-button"
                      onClick={() =>
                        useApp.setState({ modal: { kind: 'git-review', id: operation.id } })
                      }
                    >
                      Inspect result…
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="island-section">
              <div className="section-label">
                <span>Servers / Terminals</span>
                <button
                  className="icon-button"
                  title="New terminal"
                  onClick={() => void runAction(session)}
                >
                  <Plus size={13} />
                </button>
              </div>
              <div className="run-list">
                {runs.length ? (
                  runs.map((run) => (
                    <div className="action-row" key={run.id}>
                      <button
                        className="island-row"
                        title={run.name}
                        onClick={() => showSurface({ kind: 'terminal', id: run.id })}
                      >
                        <TerminalSquare size={14} />
                        <span>
                          {run.name}
                          <small>
                            {run.state === 'running' ? 'Running' : `Exited ${run.exitCode ?? ''}`}
                          </small>
                        </span>
                        <span
                          className={`process-dot ${run.state === 'running' ? 'running' : ''}`}
                        />
                      </button>
                      <button
                        className="icon-button quiet"
                        title={`Rename ${run.name}`}
                        onClick={() =>
                          useApp.setState({
                            modal: { kind: 'terminal-name', id: run.id, name: run.name },
                          })
                        }
                      >
                        <Settings2 size={12} />
                      </button>
                      {run.previewUrl && (
                        <button
                          className="icon-button"
                          title="Open server preview"
                          onClick={() => showSurface({ kind: 'browser', url: run.previewUrl! })}
                        >
                          <Globe size={13} />
                        </button>
                      )}
                      {run.state === 'running' && (
                        <button
                          className="icon-button"
                          title={`Stop ${run.name}`}
                          onClick={() =>
                            void window.superfluid
                              .call('terminal.command', { id: run.id, command: 'stop' })
                              .catch(useApp.getState().fail)
                          }
                        >
                          <Square size={11} />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <button className="island-row muted" onClick={() => void runAction(session)}>
                    <TerminalSquare size={14} />
                    <span>Open a terminal</span>
                  </button>
                )}
              </div>
            </div>
            <div className="island-section lineage">
              <div className="section-label">
                <span>Lineage</span>
                <div>
                  <button
                    className="icon-button"
                    title="Navigate back (Ctrl −)"
                    disabled={view.historyIndex <= 0}
                    onClick={() => go(-1)}
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <button
                    className="icon-button"
                    title="Navigate forward"
                    disabled={view.historyIndex >= view.history.length - 1}
                    onClick={() => go(1)}
                  >
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
              {view.history.length ? (
                view.history.slice(-3).map((item, index) => (
                  <button
                    className={`island-row ${view.historyIndex === Math.max(0, view.history.length - 3) + index ? 'current' : ''}`}
                    key={`${item.path}:${item.line}:${index}`}
                    title={`${item.path}:${item.line}`}
                    onClick={() => {
                      const n = view.history.lastIndexOf(item);
                      useApp.getState().setView({ historyIndex: n });
                      void useApp.getState().openFile(item.path, item.line, item.column, false);
                    }}
                  >
                    <ArrowUpRight size={13} />
                    <span>{item.label}</span>
                    <small>:{item.line}</small>
                  </button>
                ))
              ) : (
                <div className="lineage-empty">Jump to a definition to start a trail.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
