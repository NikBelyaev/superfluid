import {
  Files,
  GitCompareArrows,
  GitPullRequest,
  Globe,
  TerminalSquare,
  Search,
  Braces,
} from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp, showSurface, openPalette } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';
import type { TabGroup } from '~/state/workspaceView';

export const surfaceActions = (session: Session, group: TabGroup) => [
  {
    icon: Globe,
    label: 'Browser',
    shortcut: 'B',
    run: () => showSurface({ kind: 'browser', url: 'http://localhost:8000' }, session.id, group),
  },
  {
    icon: TerminalSquare,
    label: 'Terminal',
    shortcut: 'T',
    run: () => void runAction(session, undefined, group),
  },
  {
    icon: Search,
    label: 'Search worktree',
    shortcut: 'S',
    run: () => openPalette('search'),
  },
  {
    icon: Braces,
    label: 'Go to symbol',
    shortcut: 'Y',
    run: () => openPalette('symbols'),
  },
  {
    icon: Files,
    label: 'Files',
    shortcut: 'F',
    run: () => showSurface({ kind: 'files' }, session.id, group),
  },
  {
    icon: GitCompareArrows,
    label: 'Diff',
    shortcut: 'D',
    run: () => showSurface({ kind: 'diff' }, session.id, group),
  },
  {
    icon: GitPullRequest,
    label: 'Pull / merge requests',
    shortcut: 'P',
    run: () => showSurface({ kind: 'pr' }, session.id, group),
  },
];

export function SurfaceLauncher({
  session,
  group = 'right',
}: {
  session: Session;
  group?: TabGroup;
}) {
  return (
    <div className="surface-launcher">
      <h3>Open a surface</h3>
      {surfaceActions(session, group).map(({ icon: Icon, label, run }) => (
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
