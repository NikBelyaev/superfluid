import { GitBranch, Plus } from 'lucide-react';
import { useApp } from '~/state/workspaceStore';
import type { Session } from '@superfluid/contracts';

export function WorktreeStrip({ session }: { session: Session }) {
  const sessions = useApp((a) => a.sessions);
  return (
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
  );
}
