import { useState, type ReactNode } from 'react';
import { useApp } from '~/state/workspaceStore';
import { closeDialog as close } from '~/state/dialogs';

export function Form({
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
      className="dialog-form"
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
