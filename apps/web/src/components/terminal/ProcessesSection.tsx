import { desktop } from '~/rpc/desktop';
import { TerminalSquare, Square, Globe } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Session } from '@superfluid/contracts';
import { showSurface, useApp } from '~/state/workspaceStore';

export function ProcessesSection({ session }: { session: Session }) {
  const servers = useApp(
    useShallow((app) => app.servers.filter((server) => server.sessionId === session.id)),
  );
  if (!servers.length) return null;
  return (
    <div className="island-section">
      <div className="section-label">
        <span>Servers</span>
      </div>
      <div className="run-list">
        {servers.map((server) => (
          <div className="action-row" key={`${server.terminalId}:${server.pid}:${server.port}`}>
            <button
              className="island-row"
              title={`Open localhost:${server.port} in browser`}
              onClick={() => showSurface({ kind: 'browser', url: server.url }, session.id)}
            >
              <Globe size={14} />
              <span>
                localhost:{server.port}
                <small>{server.name}</small>
              </span>
            </button>
            <button
              className="icon-button quiet"
              title={`Open terminal for localhost:${server.port}`}
              onClick={() => showSurface({ kind: 'terminal', id: server.terminalId }, session.id)}
            >
              <TerminalSquare size={13} />
            </button>
            <button
              className="icon-button"
              title={`Stop localhost:${server.port}`}
              onClick={() =>
                void desktop
                  .call('terminal.server.stop', {
                    sessionId: session.id,
                    terminalId: server.terminalId,
                    pid: server.pid,
                    port: server.port,
                  })
                  .catch(useApp.getState().fail)
              }
            >
              <Square size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
