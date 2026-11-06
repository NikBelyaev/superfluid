import { useState } from 'react';
import { currentSession } from '~/state/workspaceStore';
import { Form } from '~/components/dialogs/DialogForm';
import { closeDialog as close } from '~/state/dialogs';

export function RenameSymbolDialog({
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
        const { documents } = await import('~/state/editor/Documents');
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
          const { documents } = await import('~/state/editor/Documents');
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
