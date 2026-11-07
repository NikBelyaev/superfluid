import { FileCode2, GitCompareArrows, GitPullRequest, Globe, TerminalSquare } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp, showSurface } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';

export function SurfaceLauncher({ session }: { session: Session }) {
  return (
    <div className="surface-launcher">
      <h3>Open a surface</h3>
      {[
        {
          icon: Globe,
          label: 'Browser',
          run: () => showSurface({ kind: 'browser', url: 'http://localhost:8000' }),
        },
        { icon: TerminalSquare, label: 'Terminal', run: () => void runAction(session) },
        {
          icon: FileCode2,
          label: 'Files',
          run: () => {
            const view = useApp.getState().views[session.id];
            if (view.active) showSurface({ kind: 'file', path: view.active });
            else useApp.setState({ palette: 'files' });
          },
        },
        {
          icon: GitCompareArrows,
          label: 'Diff',
          run: () => showSurface({ kind: 'diff' }),
        },
        {
          icon: GitPullRequest,
          label: 'Pull / merge requests',
          run: () => showSurface({ kind: 'pr' }, session.id),
        },
      ].map(({ icon: Icon, label, run }) => (
        <button
          className="launcher-row"
          key={label}
          aria-label={label}
          onClick={() => {
            useApp.setState({ modal: null });
            run();
          }}
        >
          <Icon size={16} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
