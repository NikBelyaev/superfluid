import { useEffect } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ChevronDown, GitBranch } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { openRepositoryMenu } from '~/commands/gitBatch';
import { RepositoryBranch } from './RepositoryBranch';
import { RepositoryPicker } from './RepositoryPicker';
import { RepositoryGraph } from './RepositoryGraph';
import { GitActionForm } from './GitActionForm';
import './RepositoryMenu.css';

export function RepositoryMenu({ session }: { session: Session }) {
  const menu = useApp((s) => s.repositoryMenu);
  const repositories = useApp((s) => s.repositories[session.id]);
  const running = useApp(
    (s) => s.gitBatches[session.id]?.phase === 'running' || !!s.repositoryWorktrees[session.id],
  );
  const open = menu?.sessionId === session.id;
  const page = open ? menu.page : 'repositories';
  const graph = page === 'repositories' || page === 'create-branch' || page === 'checkout';
  const close = () =>
    useApp.setState((s) => ({
      repositoryMenu: s.repositoryMenu === menu ? null : s.repositoryMenu,
    }));
  useEffect(() => {
    if (open)
      void useApp.getState().refreshRepositories(session.id, true).catch(useApp.getState().fail);
  }, [open, session.id]);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => (next ? openRepositoryMenu(session.id) : close())}
    >
      <Popover.Trigger
        className="island-row branch-row"
        disabled={running}
        aria-label="Project repositories"
      >
        <GitBranch size={14} />
        <RepositoryBranch sessionId={session.id} />
        <ChevronDown size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="left"
          align="center"
          sideOffset={12}
          collisionPadding={12}
          className="menu-positioner"
        >
          <Popover.Popup
            className={`repository-popup${graph ? '' : ' repository-composer-popup'}`}
            aria-label="Branches and repositories"
            initialFocus={false}
          >
            {graph ? (
              <>
                {(repositories?.length || 0) > 1 && (
                  <RepositoryPicker session={session} disabled={running} />
                )}
                <RepositoryGraph
                  key={`${session.id}:${page}`}
                  session={session}
                  onComplete={close}
                  initialAction={page === 'repositories' ? undefined : page}
                />
              </>
            ) : (
              <GitActionForm
                key={`${session.id}:${page}`}
                session={session}
                action={page}
                onClose={close}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
