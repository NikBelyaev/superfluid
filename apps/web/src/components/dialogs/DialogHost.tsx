import { lazy, Suspense } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useApp, currentSession } from '~/state/workspaceStore';
import { closeDialog as close } from '~/state/dialogs';
import { ProjectActionDialog } from '~/components/scripts/ProjectActionDialog';
import { NewWorktreeDialog } from '~/components/workspace/NewWorktreeDialog';
import { GitDialog } from '~/components/vcs/GitDialog';
import { CloneRepositoryDialog } from '~/components/projects/CloneRepositoryDialog';
import { FileDialog } from '~/components/editor/FileDialog';
import { TerminalNameDialog } from '~/components/terminal/TerminalNameDialog';
import { GitReviewDialog } from '~/components/vcs/GitReviewDialog';
import { InterpreterDialog } from '~/components/python/InterpreterDialog';
import { RenameSymbolDialog } from '~/components/editor/RenameSymbolDialog';
import { SettingsLayout } from '~/components/settings/SettingsLayout';
import { SettingsSkeleton } from '~/components/settings/SettingsSkeleton';

const Launcher = lazy(() =>
  import('~/components/surfaces/SurfaceLauncher').then((m) => ({ default: m.SurfaceLauncher })),
);
const SettingsPage = lazy(() => import('~/components/settings/SettingsPage'));

export default function DialogHost() {
  const modal = useApp((a) => a.modal);
  if (!modal) return null;
  const titles = {
    settings: 'Settings',
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
        <Dialog.Popup
          className={
            modal.kind === 'settings'
              ? 'fixed top-1/2 left-1/2 z-[101] flex h-[760px] max-h-[calc(100dvh-64px)] w-[1100px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-(--shadow-dialog) outline-none'
              : `modal ${modal.kind === 'launcher' ? 'launcher-modal' : ''}`
          }
        >
          {modal.kind !== 'settings' && (
            <div className="modal-heading">
              <Dialog.Title>{titles[modal.kind]}</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="Close dialog">
                <X size={17} />
              </Dialog.Close>
            </div>
          )}
          {modal.kind === 'settings' ? (
            <SettingsLayout initialSection={modal.section}>
              <Suspense fallback={<SettingsSkeleton />}>
                <SettingsPage />
              </Suspense>
            </SettingsLayout>
          ) : modal.kind === 'action' ? (
            <ProjectActionDialog action={modal.action} />
          ) : modal.kind === 'worktree' ? (
            <NewWorktreeDialog />
          ) : modal.kind === 'git' ? (
            <GitDialog
              action={modal.action}
              sessionId={modal.sessionId}
              repositoryId={modal.repositoryId}
            />
          ) : modal.kind === 'git-review' ? (
            <GitReviewDialog id={modal.id} />
          ) : modal.kind === 'terminal-name' ? (
            <TerminalNameDialog id={modal.id} name={modal.name} />
          ) : modal.kind === 'clone' ? (
            <CloneRepositoryDialog />
          ) : modal.kind === 'new-file' ? (
            <FileDialog directory={modal.directory} parent={modal.parent} />
          ) : modal.kind === 'rename' ? (
            <FileDialog path={modal.path} />
          ) : modal.kind === 'interpreter' ? (
            <InterpreterDialog />
          ) : modal.kind === 'rename-symbol' ? (
            <RenameSymbolDialog source={modal.source} edit={modal.edit} />
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
