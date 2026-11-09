import { SquareMenu } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';
import { activeFile } from '~/state/workspaceView';
import { FileBreadcrumbs } from './FileBreadcrumbs';
import type { Session } from '@superfluid/contracts';

export function Statusbar({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]),
    language = useApp((a) => a.language),
    island = useApp((a) => a.island);
  const path = activeFile(view);
  return (
    <footer className="statusbar">
      {path ? (
        <FileBreadcrumbs key={`${session.id}:${path}`} session={session} path={path} />
      ) : (
        <span className="status-path">No file selected</span>
      )}
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
        <SquareMenu size={13} />
      </button>
    </footer>
  );
}
