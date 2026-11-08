import { desktop } from '~/rpc/desktop';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Search, Command, FileCode2, ArrowUpRight } from 'lucide-react';
import type { SearchHit } from '@superfluid/contracts';
import { useApp, currentSession, showSurface } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';
import { openRepositoryMenu } from '~/commands/gitBatch';
import { checkForAppUpdates } from '~/commands/updateApp';

export default function CommandPalette() {
  const mode = useApp((a) => a.palette),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<SearchHit[]>([]),
    [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0),
    session = currentSession();
  const commands = [
    { name: 'Check for app updates', run: checkForAppUpdates },
    {
      name: 'Settings: About',
      run: () => useApp.setState({ modal: { kind: 'settings', section: 'about' } }),
    },
    { name: 'Manage repositories', run: () => session && openRepositoryMenu(session.id) },
    {
      name: 'Create branch in selected repositories',
      run: () => session && openRepositoryMenu(session.id, 'create-branch'),
    },
    {
      name: 'Switch branch in selected repositories',
      run: () => session && openRepositoryMenu(session.id, 'checkout'),
    },
    {
      name: 'Commit selected repositories',
      run: () => session && openRepositoryMenu(session.id, 'commit'),
    },
    {
      name: 'Push selected repositories',
      run: () => session && openRepositoryMenu(session.id, 'push'),
    },
    { name: 'Settings: Appearance', run: () => useApp.setState({ modal: { kind: 'settings' } }) },
    { name: 'New worktree', run: () => useApp.setState({ modal: { kind: 'worktree' } }) },
    { name: 'New terminal', run: () => session && void runAction(session) },
    { name: 'Show changes', run: () => showSurface({ kind: 'diff' }) },
    {
      name: 'Open pull / merge requests',
      run: () => session && showSurface({ kind: 'pr' }, session.id),
    },
    {
      name: 'Create pull / merge request',
      run: () =>
        session && useApp.setState({ modal: { kind: 'git', action: 'pr', sessionId: session.id } }),
    },
    {
      name: 'Settings: Source Control',
      run: () => useApp.setState({ modal: { kind: 'settings', section: 'hosting' } }),
    },
    { name: 'Open a surface', run: () => useApp.setState({ modal: { kind: 'launcher' } }) },
    { name: 'Add project action', run: () => useApp.setState({ modal: { kind: 'action' } }) },
    {
      name: 'Choose Python interpreter',
      run: () => useApp.setState({ modal: { kind: 'interpreter' } }),
    },
    {
      name: 'Open project files',
      run: () => session && showSurface({ kind: 'files' }, session.id),
    },
    { name: 'Toggle action island', run: () => useApp.setState((s) => ({ island: !s.island })) },
  ].filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    setQuery('');
    setHits([]);
    setIndex(0);
    setError('');
  }, [mode]);
  useEffect(() => {
    const gen = ++generation.current;
    setIndex(0);
    if (!session || mode === 'commands' || !query.trim()) {
      setHits([]);
      return;
    }
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      void desktop
        .call('files.search', { sessionId: session.id, query, content: mode === 'search' })
        .then((result) => {
          if (generation.current === gen) setHits(result.hits);
        })
        .catch((e) => {
          if (generation.current === gen) setError(e.message);
        })
        .finally(() => {
          if (generation.current === gen) setBusy(false);
        });
    }, 100);
    return () => clearTimeout(timer);
  }, [query, session?.id, mode]);
  const choose = (i: number) => {
    useApp.setState({ palette: null });
    if (mode === 'commands') commands[i]?.run();
    else if (hits[i]) void useApp.getState().openFile(hits[i].path, hits[i].line);
  };
  const length = mode === 'commands' ? commands.length : hits.length;
  return (
    <Dialog.Root
      open={!!mode}
      onOpenChange={(open) => {
        if (!open) useApp.setState({ palette: null });
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className="palette">
          <Dialog.Title className="sr-only">
            {mode === 'commands'
              ? 'Commands'
              : mode === 'search'
                ? 'Search in project'
                : 'Find a file'}
          </Dialog.Title>
          <div className="palette-input">
            {mode === 'commands' ? <Command size={18} /> : <Search size={18} />}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === 'commands'
                  ? 'What would you like to do?'
                  : mode === 'search'
                    ? 'Search text in this worktree…'
                    : 'Find a file by name…'
              }
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex(Math.min(length - 1, index + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex(Math.max(0, index - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(index);
                }
              }}
            />
            <kbd>esc</kbd>
          </div>
          <div className="palette-results">
            {mode === 'commands'
              ? commands.map((c, i) => (
                  <button
                    key={c.name}
                    className={`palette-result ${i === index ? 'selected' : ''}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(i)}
                  >
                    <Command size={14} />
                    <span>{c.name}</span>
                    <ArrowUpRight size={13} />
                  </button>
                ))
              : hits.map((hit, i) => (
                  <button
                    key={`${hit.path}:${hit.line ?? ''}:${i}`}
                    className={`palette-result ${i === index ? 'selected' : ''}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(i)}
                  >
                    <FileCode2 size={14} />
                    <span>
                      {hit.path}
                      {hit.line && (
                        <small>
                          {hit.line}: {hit.text}
                        </small>
                      )}
                    </span>
                  </button>
                ))}
            {error ? (
              <p className="inline-error">{error}</p>
            ) : busy ? (
              <p className="palette-hint">Searching…</p>
            ) : (
              !length && (
                <p className="palette-hint">
                  {query ? 'No matching results.' : 'Start typing to search.'}
                </p>
              )
            )}
          </div>
          <div className="palette-footer">
            <span>↑ ↓ to navigate</span>
            <span>↵ to open</span>
            <span className="spacer" />
            {session?.branch}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
