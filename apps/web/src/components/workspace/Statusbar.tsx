import { Blocks } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';
import type { Session } from '@superfluid/contracts';

export function Statusbar({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]),
    status = useApp((a) => a.git[session.id]),
    language = useApp((a) => a.language),
    island = useApp((a) => a.island);
  return (
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
  );
}
