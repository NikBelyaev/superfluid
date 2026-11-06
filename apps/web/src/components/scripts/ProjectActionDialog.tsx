import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { useApp, currentSession } from '~/state/workspaceStore';
import type { Action } from '@superfluid/contracts';
import { Form } from '~/components/dialogs/DialogForm';
import { closeDialog as close } from '~/state/dialogs';
import { keySignature } from '~/shortcuts/keySignature';

export function ProjectActionDialog({ action }: { action?: Action }) {
  const session = currentSession()!,
    [name, setName] = useState(action?.name ?? ''),
    [kind, setKind] = useState<Action['kind']>(action?.kind ?? 'shell'),
    [command, setCommand] = useState(action?.command ?? ''),
    [cwd, setCwd] = useState(action?.cwd ?? ''),
    [shortcut, setShortcut] = useState(action?.shortcut ?? ''),
    [url, setUrl] = useState(action?.previewUrl ?? '');
  return (
    <Form
      label={action ? 'Save action' : 'Create action'}
      submit={async () => {
        const a = await desktop.call('actions.save', {
          id: action?.id,
          projectId: session.projectId,
          name,
          kind,
          command,
          cwd,
          shortcut,
          previewUrl: url,
        });
        useApp.setState((s) => ({ actions: [...s.actions.filter((x) => x.id !== a.id), a] }));
      }}
      danger={
        action && (
          <button
            className="text-button negative"
            type="button"
            onClick={async () => {
              await desktop.call('actions.delete', { id: action.id });
              useApp.setState((s) => ({ actions: s.actions.filter((a) => a.id !== action.id) }));
              close();
            }}
          >
            Delete action
          </button>
        )
      }
    >
      <p className="modal-description">
        Project commands run in the selected worktree. Processes keep running when you switch.
      </p>
      <label>
        Name
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Run tests"
        />
      </label>
      <label>
        Action type
        <select
          value={kind}
          onChange={(e) => {
            const next = e.target.value as Action['kind'];
            setKind(next);
            if (next === 'django') {
              setCommand('manage.py');
              setUrl('http://127.0.0.1:8000');
              if (!name) setName('Django server');
            }
          }}
        >
          <option value="shell">Shell command</option>
          <option value="python">Python file</option>
          <option value="django">Django server</option>
        </select>
      </label>
      <label>
        {kind === 'shell' ? 'Command' : kind === 'django' ? 'Manage script' : 'Python file'}
        <textarea
          required
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={
            kind === 'shell' ? 'python -m pytest' : kind === 'django' ? 'manage.py' : 'main.py'
          }
          rows={3}
        />
      </label>
      <div className="form-columns">
        <label>
          Working directory
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="Project root" />
        </label>
        <label>
          Keybinding
          <input
            value={shortcut.replaceAll('Meta', '⌘').replaceAll('Key', '')}
            placeholder="Press shortcut"
            readOnly
            onKeyDown={(e) => {
              e.preventDefault();
              if (e.key === 'Escape') {
                setShortcut('');
                return;
              }
              if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
              if (e.metaKey && ['KeyQ', 'KeyW'].includes(e.code)) return;
              setShortcut(keySignature(e.nativeEvent));
            }}
          />
        </label>
      </div>
      <label>
        Preview URL <span className="muted">optional</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8000"
        />
      </label>
    </Form>
  );
}
