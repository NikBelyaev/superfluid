import { desktop } from '~/rpc/desktop';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Columns2, FileCode2, RefreshCw, Rows2 } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { Patch } from './Patch';

export function Diff({
  session,
  path,
  initialMode,
}: {
  session: Session;
  path?: string;
  initialMode?: 'unstaged' | 'staged' | 'branch';
}) {
  const status = useApp((a) => a.git[session.id]);
  const [mode, setMode] = useState(initialMode ?? 'unstaged'),
    [base, setBase] = useState('origin/main'),
    [split, setSplit] = useState(false),
    [patch, setPatch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(0);
  const selected = path ?? status?.files[0]?.path;
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError('');
    void desktop
      .call('git.diff', { sessionId: session.id, path: selected, mode, base })
      .then((text) => {
        if (!cancelled) setPatch(text);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, selected, mode, base, token]);
  return (
    <div className="surface-content">
      <div className="surface-toolbar">
        <select
          aria-label="Diff comparison"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="unstaged">Working tree → Index</option>
          <option value="staged">Index → HEAD</option>
          <option value="branch">Branch → Base</option>
        </select>
        {mode === 'branch' && (
          <input
            aria-label="Diff base reference"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        )}
        <div className="spacer" />
        <button className="icon-button" title="Toggle split diff" onClick={() => setSplit(!split)}>
          {split ? <Rows2 size={14} /> : <Columns2 size={14} />}
        </button>
        <button className="icon-button" title="Refresh diff" onClick={() => setToken(token + 1)}>
          <RefreshCw size={13} />
        </button>
      </div>
      {selected && (
        <button className="diff-path" onClick={() => void useApp.getState().openFile(selected)}>
          <FileCode2 size={13} />
          {selected}
          <ArrowUpRight size={12} />
        </button>
      )}
      {error ? (
        <div className="surface-empty error-text">{error}</div>
      ) : busy ? (
        <div className="surface-empty">Loading changes…</div>
      ) : patch ? (
        <Patch patch={patch} split={split} />
      ) : (
        <div className="surface-empty">
          <Check size={24} />
          <h3>No changes in this comparison</h3>
          <p>{selected ? 'Try Staged or another base reference.' : 'Your worktree is clean.'}</p>
        </div>
      )}
    </div>
  );
}
