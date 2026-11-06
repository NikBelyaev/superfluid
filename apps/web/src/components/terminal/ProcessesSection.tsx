import { desktop } from '~/rpc/desktop';
import { Plus, TerminalSquare, Square, Settings2, Globe } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Session } from '@superfluid/contracts';
import { showSurface, useApp } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';

export function ProcessesSection({ session }: { session: Session }) {
  const runs = useApp(useShallow((a) => a.runs.filter((x) => x.sessionId === session.id)));
  return (
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
                <span className={`process-dot ${run.state === 'running' ? 'running' : ''}`} />
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
                    void desktop
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
  );
}
