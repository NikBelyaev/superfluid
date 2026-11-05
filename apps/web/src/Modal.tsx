import { useState, useEffect, lazy, Suspense, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X, FolderOpen, GitBranch } from 'lucide-react';
import { useApp, currentSession, showSurface } from './state';
import type { Action } from '../../../packages/contracts';
const Launcher = lazy(() => import('./Surfaces').then((m) => ({ default: m.SurfaceLauncher })));
const close = () => useApp.setState({ modal: null });
export const keySignature = (
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code'>,
) =>
  [
    e.metaKey ? 'Meta' : '',
    e.ctrlKey ? 'Control' : '',
    e.altKey ? 'Alt' : '',
    e.shiftKey ? 'Shift' : '',
    e.code,
  ]
    .filter(Boolean)
    .join('+');

function Form({
  children,
  submit,
  label = 'Save',
  danger,
}: {
  children: ReactNode;
  submit: () => Promise<void>;
  label?: string;
  danger?: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const modal = useApp.getState().modal;
        try {
          await submit();
          if (useApp.getState().modal === modal) close();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <footer className="modal-footer">
        {danger}
        <div className="spacer" />
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? 'Working…' : label}
        </button>
      </footer>
    </form>
  );
}
function ActionForm({ action }: { action?: Action }) {
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
        const a = await window.superfluid.call('actions.save', {
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
              await window.superfluid.call('actions.delete', { id: action.id });
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
function WorktreeForm() {
  const session = currentSession()!,
    status = useApp((a) => a.git[session.id]),
    [branch, setBranch] = useState(''),
    [base, setBase] = useState(session.branch || 'HEAD');
  return (
    <Form
      label="Create worktree"
      submit={async () => {
        const created = await window.superfluid.call('session.create', {
          sessionId: session.id,
          branch,
          base,
        });
        const app = useApp.getState(),
          project = app.projects.find((p) => p.id === session.projectId)!;
        await app.openProject(project);
        useApp.getState().switchSession(created.id);
      }}
    >
      <p className="modal-description">
        A separate folder and working session. Your current changes and processes stay here.
      </p>
      <label>
        Branch name
        <input
          autoFocus
          required
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feature/my-change"
        />
      </label>
      <label>
        Start from
        <input
          required
          list="branch-options"
          value={base}
          onChange={(e) => setBase(e.target.value)}
        />
        <datalist id="branch-options">
          {status?.branches.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <div className="hint-box">
        <GitBranch size={15} />
        The worktree gets its own files, editor state and terminals. Dependencies are not installed
        automatically.
      </div>
    </Form>
  );
}
function GitForm({ action }: { action: 'commit' | 'push' | 'pr' | 'publish' }) {
  const s = currentSession()!,
    status = useApp((a) => a.git[s.id]);
  const [operationId] = useState(() => crypto.randomUUID()),
    [message, setMessage] = useState(''),
    [base, setBase] = useState('main'),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [draft, setDraft] = useState(true),
    [selected, setSelected] = useState<string[]>(
      status?.files.filter((f) => f.index !== '?').map((f) => f.path) ?? [],
    );
  return (
    <Form
      label={
        action === 'publish'
          ? 'Commit, push & PR'
          : action === 'pr'
            ? 'Create pull request'
            : action === 'push'
              ? 'Push branch'
              : 'Commit changes'
      }
      submit={async () => {
        const { documents } = await import('./documents');
        const dirty = [...documents.items.values()].filter((d) => d.session.id === s.id && d.dirty);
        if (dirty.length)
          throw new Error(
            `Save ${dirty.length} unsaved file${dirty.length === 1 ? '' : 's'} before publishing.`,
          );
        const op = await window.superfluid.call('git.act', {
          sessionId: s.id,
          operationId,
          action,
          message,
          paths: selected,
          base,
          title,
          body,
          draft,
        });
        await useApp.getState().refreshGit(s.id);
        if (op.error) throw new Error(op.error);
        if (op.url) showSurface({ kind: 'pr' }, s.id);
      }}
    >
      <div className="git-target">
        <GitBranch size={14} />
        <strong>{status?.branch || s.branch}</strong>
        <span className="muted">in {s.path.split('/').at(-1)}</span>
      </div>
      {(action === 'commit' || action === 'publish') && (
        <>
          <label>
            Commit message
            <textarea
              autoFocus
              required
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (!title) setTitle(e.target.value.split('\n')[0]);
              }}
              rows={3}
              placeholder="Describe the change"
            />
          </label>
          <label>Files to stage</label>
          <div className="commit-files">
            {status?.files.map((file) => (
              <label className="checkbox-row" key={file.path}>
                <input
                  type="checkbox"
                  checked={selected.includes(file.path)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, file.path]
                        : selected.filter((x) => x !== file.path),
                    )
                  }
                />
                <span className="git-letter">
                  {file.index === '?' ? 'U' : file.worktree !== '.' ? file.worktree : file.index}
                </span>
                <span>{file.path}</span>
              </label>
            ))}
          </div>
          <p className="field-hint">
            Already staged files are also included. New files are selected explicitly.
          </p>
        </>
      )}
      {(action === 'pr' || action === 'publish') && (
        <>
          <div className="form-columns">
            <label>
              PR title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={s.branch}
              />
            </label>
            <label>
              Base branch
              <input required value={base} onChange={(e) => setBase(e.target.value)} />
            </label>
          </div>
          <label>
            Description
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            Create as draft
          </label>
        </>
      )}
      {action === 'publish' && (
        <p className="field-hint">
          Runs Commit → Push → Create PR in order. Unexpected Git changes stop publication.
        </p>
      )}
    </Form>
  );
}
function CloneForm() {
  const [url, setUrl] = useState(''),
    [destination, setDestination] = useState('');
  return (
    <Form
      label="Clone repository"
      submit={async () => {
        const p = await window.superfluid.call('project.clone', { url, destination });
        await useApp.getState().bootstrap();
        await useApp.getState().openProject(p);
      }}
    >
      <label>
        Repository URL
        <input
          autoFocus
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="git@github.com:owner/project.git"
        />
      </label>
      <label>
        Destination
        <div className="input-group">
          <input
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="/path/to/project"
          />
          <button
            className="button"
            type="button"
            onClick={async () => {
              const p = await window.superfluid.chooseDirectory();
              if (p) {
                const name =
                  url
                    .split('/')
                    .at(-1)
                    ?.replace(/\.git$/, '') || 'project';
                setDestination(p + '/' + name);
              }
            }}
          >
            <FolderOpen size={15} />
          </button>
        </div>
      </label>
    </Form>
  );
}
function FileForm({
  directory,
  parent,
  path,
}: {
  directory?: boolean;
  parent?: string;
  path?: string;
}) {
  const s = currentSession()!,
    [name, setName] = useState(path ?? (parent ? parent + '/' : ''));
  const matches = (p: string) => !!path && (p === path || p.startsWith(path + '/'));
  return (
    <Form
      label={path ? 'Rename' : directory ? 'Create folder' : 'Create file'}
      submit={async () => {
        const { documents } = await import('./documents');
        if (path) {
          documents.assertClean(s.id, path);
          await window.superfluid.call('files.rename', { sessionId: s.id, path, target: name });
          documents.removePaths(s.id, path);
          const a = useApp.getState(),
            v = a.views[s.id],
            mapped = (p: string) => (matches(p) ? name + p.slice(path.length) : p);
          const surface = (p: any) => (p?.kind === 'file' ? { ...p, path: mapped(p.path) } : p);
          a.setView(
            {
              tabs: v.tabs.map(mapped),
              active: v.active ? mapped(v.active) : null,
              expanded: v.expanded.map(mapped),
              editorViews: Object.fromEntries(
                Object.entries(v.editorViews ?? {}).map(([key, value]) => [
                  key.slice(0, 5) + mapped(key.slice(5)),
                  value,
                ]),
              ),
              history: v.history.map((x) => ({ ...x, path: mapped(x.path) })),
              surface: surface(v.surface),
              rightTabs: v.rightTabs.map(surface),
            },
            s.id,
          );
        } else {
          await window.superfluid.call('files.create', {
            sessionId: s.id,
            path: name,
            directory: !!directory,
          });
          if (!directory && useApp.getState().sessionId === s.id)
            await useApp.getState().openFile(name);
        }
        useApp.setState((a) => ({ revision: a.revision + 1 }));
        await useApp.getState().refreshGit(s.id);
      }}
      danger={
        path && (
          <button
            type="button"
            className="text-button negative"
            onClick={async () => {
              if (!confirm(`Move ${path} to the Trash?`)) return;
              try {
                const { documents } = await import('./documents');
                documents.assertClean(s.id, path);
                await window.superfluid.trash(s.id, path);
                documents.removePaths(s.id, path);
                const a = useApp.getState(),
                  v = a.views[s.id],
                  rightTabs = v.rightTabs.filter((x) => x.kind !== 'file' || !matches(x.path));
                a.setView(
                  {
                    tabs: v.tabs.filter((x) => !matches(x)),
                    active: v.active && matches(v.active) ? null : v.active,
                    rightTabs,
                    editorViews: Object.fromEntries(
                      Object.entries(v.editorViews ?? {}).filter(([key]) => !matches(key.slice(5))),
                    ),
                    surface:
                      v.surface?.kind === 'file' && matches(v.surface.path)
                        ? (rightTabs.at(-1) ?? null)
                        : v.surface,
                  },
                  s.id,
                );
                useApp.setState((a) => ({ revision: a.revision + 1 }));
                close();
              } catch (e) {
                useApp.getState().fail(e);
              }
            }}
          >
            Move to Trash
          </button>
        )
      }
    >
      <label>
        {path ? 'New path' : 'Path relative to worktree'}
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={directory ? 'src' : 'main.py'}
        />
      </label>
    </Form>
  );
}
function TerminalName({ id, name: initial }: { id: string; name: string }) {
  const [name, setName] = useState(initial);
  return (
    <Form
      label="Rename terminal"
      submit={async () => {
        await window.superfluid.call('terminal.command', { id, command: 'rename', data: name });
      }}
    >
      <label>
        Terminal name
        <input
          autoFocus
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Form>
  );
}
function GitReview({ id }: { id: string }) {
  const s = currentSession()!,
    [inspection, setInspection] = useState<{ log: string; remote: string; operation: any } | null>(
      null,
    ),
    [checked, setChecked] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void window.superfluid
      .call('git.inspect', { sessionId: s.id, operationId: id })
      .then((value) => {
        if (!cancelled) setInspection(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [s.id, id]);
  return (
    <Form
      label="Allow a new Git operation"
      submit={async () => {
        if (!checked || !inspection)
          throw new Error('Inspect the local log and remote before acknowledging this attempt.');
        await window.superfluid.call('git.acknowledge', { sessionId: s.id, operationId: id });
      }}
    >
      <p className="modal-description">
        An earlier operation stopped with an uncertain result. Acknowledging it does not retry or
        undo any Git command.
      </p>
      {error && <p className="form-error">{error}</p>}
      {inspection ? (
        <>
          <label>
            Recent local commits<pre className="inspection">{inspection.log}</pre>
          </label>
          <label>
            Remote branch
            <pre className="inspection">{inspection.remote || 'No remote ref found.'}</pre>
          </label>
          <details>
            <summary>Recorded evidence</summary>
            <pre className="inspection">{JSON.stringify(inspection.operation, null, 2)}</pre>
          </details>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I checked the local and remote result before starting a new operation.
          </label>
        </>
      ) : (
        <p>Inspecting Git state…</p>
      )}
    </Form>
  );
}
function Interpreter() {
  const s = currentSession()!,
    [python, setPython] = useState(s.python);
  return (
    <Form
      label="Use interpreter"
      submit={async () => {
        const updated = await window.superfluid.call('session.interpreter', {
          sessionId: s.id,
          python,
        });
        useApp.setState((a) => ({
          sessions: a.sessions.map((x) => (x.id === s.id ? updated : x)),
        }));
      }}
    >
      <p className="modal-description">
        This interpreter applies to Python intelligence and typed Python actions in this worktree.
      </p>
      <label>
        Python interpreter
        <input
          autoFocus
          required
          value={python}
          onChange={(e) => setPython(e.target.value)}
          placeholder="/path/to/.venv/bin/python"
        />
      </label>
    </Form>
  );
}
function RenameSymbol({
  source,
  edit: initial,
}: {
  source?: { path: string; line: number; column: number };
  edit?: any;
}) {
  const s = currentSession()!,
    [name, setName] = useState(''),
    [edit, setEdit] = useState(initial),
    [error, setError] = useState('');
  const entries = edit
    ? (edit.documentChanges ??
      Object.entries(edit.changes ?? {}).map(([uri]) => ({ textDocument: { uri } })))
    : [];
  return edit ? (
    <Form
      label="Apply to buffers"
      submit={async () => {
        const { documents } = await import('./documents');
        await documents.applyWorkspaceEdit(s, edit);
      }}
    >
      <p className="modal-description">
        Review the affected documents. Changes remain unsaved until you save each file.
      </p>
      <div className="commit-files">
        {entries.map((e: any, i: number) => (
          <div className="checkbox-row" key={i}>
            {decodeURIComponent(e.textDocument?.uri ?? e.uri ?? 'Unknown file')}
          </div>
        ))}
      </div>
    </Form>
  ) : (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!source) return;
        try {
          const { documents } = await import('./documents');
          const result = await documents.prepareRename(s, source, name);
          setEdit(result);
        } catch (e: any) {
          setError(e.message);
        }
      }}
    >
      <label>
        New symbol name
        <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <footer className="modal-footer">
        <div className="spacer" />
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
        <button className="button primary">Preview changes</button>
      </footer>
    </form>
  );
}
export default function ModalHost() {
  const modal = useApp((a) => a.modal);
  if (!modal) return null;
  const titles = {
    action: 'Project action',
    worktree: 'New worktree',
    git: 'Publish changes',
    'git-review': 'Review Git operation',
    'terminal-name': 'Terminal name',
    clone: 'Clone repository',
    'new-file': modal.kind === 'new-file' && modal.directory ? 'New folder' : 'New file',
    rename: 'Rename or delete',
    interpreter: 'Python interpreter',
    launcher: 'Open a surface',
    'rename-symbol': 'Rename symbol',
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className={`modal ${modal.kind === 'launcher' ? 'launcher-modal' : ''}`}>
          <div className="modal-heading">
            <Dialog.Title>{titles[modal.kind]}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={17} />
            </Dialog.Close>
          </div>
          {modal.kind === 'action' ? (
            <ActionForm action={modal.action} />
          ) : modal.kind === 'worktree' ? (
            <WorktreeForm />
          ) : modal.kind === 'git' ? (
            <GitForm action={modal.action} />
          ) : modal.kind === 'git-review' ? (
            <GitReview id={modal.id} />
          ) : modal.kind === 'terminal-name' ? (
            <TerminalName id={modal.id} name={modal.name} />
          ) : modal.kind === 'clone' ? (
            <CloneForm />
          ) : modal.kind === 'new-file' ? (
            <FileForm directory={modal.directory} parent={modal.parent} />
          ) : modal.kind === 'rename' ? (
            <FileForm path={modal.path} />
          ) : modal.kind === 'interpreter' ? (
            <Interpreter />
          ) : modal.kind === 'rename-symbol' ? (
            <RenameSymbol source={modal.source} edit={modal.edit} />
          ) : (
            <Suspense fallback={<p>Loading…</p>}>
              <Launcher session={currentSession()!} />
            </Suspense>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
