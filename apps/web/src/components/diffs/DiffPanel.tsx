import { desktop } from '~/rpc/desktop';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Columns2, FileCode2, RefreshCw, Rows2 } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { Patch } from './Patch';
import { useFileDiff } from './useFileDiff';

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
  const repositories = useApp((a) => a.repositories[session.id]);
  const ids = useApp((a) => a.views[session.id]?.repositoryIds);
  const [mode, setMode] = useState(initialMode ?? 'unstaged'),
    [base, setBase] = useState('origin/main'),
    [split, setSplit] = useState(false),
    [patch, setPatch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(0);
  const selected = path ?? status?.files[0]?.path;
  const repository =
    (repositories || [])
      .filter((r) => selected && (!r.path || selected.startsWith(r.path + '/')))
      .sort((a, b) => b.path.length - a.path.length)[0] ||
    (!selected ? repositories?.find((r) => r.id === ids?.[0]) : undefined);
  const repositoryPath =
    selected && repository?.path ? selected.slice(repository.path.length + 1) : selected;
  const live = mode === 'unstaged' && !!selected && !selected.endsWith('/');
  const working = useFileDiff(session, live ? selected : undefined, token);
  const useBuffer = live && !working?.unsupported;
  useEffect(() => {
    if (useBuffer || (selected?.endsWith('/') && mode === 'unstaged')) return;
    let cancelled = false;
    setBusy(true);
    setError('');
    void desktop
      .call('git.diff', {
        sessionId: session.id,
        repositoryId: repository?.id,
        path: repositoryPath,
        mode,
        base,
      })
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
  }, [session.id, repository?.id, repositoryPath, mode, base, token, status, useBuffer]);
  const currentError = useBuffer ? working?.error : error;
  const loading = useBuffer ? !working?.files && !working?.error : busy;
  const changed = useBuffer ? working?.files?.some((file) => file.hunks.length) : !!patch;
  return (
    <div className="surface-content">
      <div className="surface-toolbar">
        <select
          aria-label="Diff comparison"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="unstaged">Index → Working buffer</option>
          <option value="staged">HEAD → Index (staged)</option>
          <option value="branch">Base → Branch</option>
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
        <button
          className="diff-path"
          disabled={selected.endsWith('/')}
          onClick={() => {
            if (useApp.getState().sessionId === session.id)
              void useApp.getState().openFile(selected);
          }}
        >
          <FileCode2 size={13} />
          {selected}
          {!selected.endsWith('/') && <ArrowUpRight size={12} />}
        </button>
      )}
      {selected?.endsWith('/') && mode === 'unstaged' ? (
        <div className="surface-empty">
          <h3>Untracked directory</h3>
          <p>Open individual files from the project tree to review changes.</p>
        </div>
      ) : currentError ? (
        <div className="surface-empty error-text">{currentError}</div>
      ) : loading ? (
        <div className="surface-empty">Loading changes…</div>
      ) : changed ? (
        <Patch
          patch={useBuffer ? undefined : patch}
          files={useBuffer ? working?.files : undefined}
          split={split}
        />
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
