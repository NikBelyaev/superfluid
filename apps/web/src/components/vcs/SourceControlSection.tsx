import { desktop } from '~/rpc/desktop';
import { ChevronDown, FileDiff, GitBranch, GitPullRequest } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import type { Session } from '@superfluid/contracts';
import { showSurface, useApp } from '~/state/workspaceStore';

export function SourceControlSection({ session }: { session: Session }) {
  const status = useApp((a) => a.git[session.id]),
    operation = useApp((a) => a.operations.filter((x) => x.sessionId === session.id).at(-1));
  return (
    <div className="island-section">
      <button
        className="island-row branch-row"
        title={status?.branch || session.branch || 'Initialize Git'}
        onClick={() => {
          if (status?.repo) useApp.setState({ modal: { kind: 'worktree' } });
          else
            void desktop
              .call('git.init', { sessionId: session.id })
              .then(() => {
                const app = useApp.getState(),
                  project = app.projects.find((p) => p.id === session.projectId);
                if (project) return app.openProject(project);
              })
              .catch(useApp.getState().fail);
        }}
      >
        <GitBranch size={14} />
        <span>{status?.branch || session.branch || 'Initialize Git'}</span>
        <ChevronDown size={13} />
      </button>
      <div className="split-action">
        <button
          className="island-row"
          disabled={!status?.repo}
          onClick={() => useApp.setState({ modal: { kind: 'git', action: 'publish' } })}
        >
          <GitPullRequest size={14} />
          <span>Commit, push & PR</span>
        </button>
        <Menu.Root>
          <Menu.Trigger
            className="split-menu-trigger"
            aria-label="Individual Git actions"
            disabled={!status?.repo}
          >
            <ChevronDown size={16} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
              <Menu.Popup className="small-menu">
                {(['commit', 'push', 'pr'] as const).map((action) => (
                  <Menu.Item
                    key={action}
                    onClick={() => useApp.setState({ modal: { kind: 'git', action } })}
                  >
                    {action === 'pr' ? 'Create PR' : action[0].toUpperCase() + action.slice(1)}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <button
        className="island-row"
        title="Line totals exclude untracked directories"
        onClick={() => showSurface({ kind: 'diff' })}
      >
        <FileDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>Changes</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs leading-5 font-normal whitespace-nowrap tabular-nums">
          <span
            className={
              status?.changes.insertions ? 'text-diff-addition-foreground' : 'text-muted-foreground'
            }
          >
            +{(status?.changes.insertions ?? 0).toLocaleString('en-US')}
          </span>
          <span
            className={
              status?.changes.deletions ? 'text-diff-deletion-foreground' : 'text-muted-foreground'
            }
          >
            -{(status?.changes.deletions ?? 0).toLocaleString('en-US')}
          </span>
        </span>
      </button>
      {operation && operation.phase !== 'completed' && (
        <div className={`operation-state ${operation.error ? 'error-text' : ''}`}>
          {operation.phase.replaceAll('-', ' ')}
          {operation.error && ' · ' + operation.error}
          {[
            'committing',
            'committed',
            'pushing',
            'pushed',
            'creating-pr',
            'uncertain',
            'needs-review',
          ].includes(operation.phase) && (
            <button
              className="text-button"
              onClick={() => useApp.setState({ modal: { kind: 'git-review', id: operation.id } })}
            >
              Inspect result…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
