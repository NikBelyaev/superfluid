import { desktop } from '~/rpc/desktop';
import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useApp, currentSession, showSurface } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';

export function GitDialog({ action }: { action: 'commit' | 'push' | 'pr' | 'publish' }) {
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
        const { documents } = await import('~/state/editor/Documents');
        const dirty = [...documents.items.values()].filter((d) => d.session.id === s.id && d.dirty);
        if (dirty.length)
          throw new Error(
            `Save ${dirty.length} unsaved file${dirty.length === 1 ? '' : 's'} before publishing.`,
          );
        const op = await desktop.call('git.act', {
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
