import { currentSession, useApp } from '~/state/workspaceStore';
import { closeDialog } from '~/state/dialogs';
import { GitActionForm } from './GitActionForm';

export function GitDialog({ action }: { action: 'commit' | 'push' | 'pr' | 'publish' }) {
  const session = currentSession()!;
  const modal = useApp((state) => state.modal);
  return (
    <GitActionForm
      session={session}
      action={action}
      onClose={() => {
        if (useApp.getState().modal === modal) closeDialog();
      }}
    />
  );
}
