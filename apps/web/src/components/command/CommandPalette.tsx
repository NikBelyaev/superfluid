import { useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Command, ArrowUpRight } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp, showSurface } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';
import { openRepositoryMenu } from '~/commands/gitBatch';
import { checkForAppUpdates } from '~/commands/updateApp';
import { SearchDialog } from '~/components/search/SearchDialog';

export default function CommandPalette() {
  const mode = useApp((a) => a.palette);
  const session = useApp((a) => a.sessions.find((s) => s.id === a.sessionId));
  if (!mode) return null;
  if (mode !== 'commands')
    return session ? (
      <SearchDialog key={`${session.id}:${mode}`} session={session} mode={mode} />
    ) : null;
  return <Commands session={session} />;
}

function Commands({ session }: { session?: Session }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    selected.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const commands = [
    { name: 'Find a file', run: () => useApp.setState({ palette: 'files' }) },
    { name: 'Search worktree', run: () => useApp.setState({ palette: 'search' }) },
    { name: 'Go to symbol in worktree', run: () => useApp.setState({ palette: 'symbols' }) },
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

  const choose = (i: number) => {
    useApp.setState({ palette: null });
    commands[i]?.run();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) useApp.setState({ palette: null });
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className="palette" initialFocus={input}>
          <Dialog.Title className="sr-only">Commands</Dialog.Title>
          <div className="palette-input">
            <Command size={18} />
            <input
              ref={input}
              aria-label="Search commands"
              placeholder="What would you like to do?"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex(
                    Math.max(
                      0,
                      Math.min(commands.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)),
                    ),
                  );
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(index);
                }
              }}
            />
            <kbd>esc</kbd>
          </div>
          <div className="palette-results">
            {commands.map((command, i) => (
              <button
                key={command.name}
                ref={i === index ? selected : undefined}
                className={`palette-result ${i === index ? 'selected' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <Command size={14} />
                <span>{command.name}</span>
                <ArrowUpRight size={13} />
              </button>
            ))}
            {!commands.length && <p className="palette-hint">No matching commands.</p>}
          </div>
          <div className="palette-footer">
            <span>↑ ↓ to navigate</span>
            <span>↵ to run</span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
