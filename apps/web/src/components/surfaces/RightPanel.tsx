import { lazy, Suspense, useState } from 'react';
import {
  Columns2,
  FileCode2,
  GitCompareArrows,
  GitPullRequest,
  Globe,
  Maximize2,
  Plus,
  TerminalSquare,
  X,
} from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp, surfaceKey, type Surface } from '~/state/workspaceStore';
import { navigateTabs, useActiveTab } from '~/hooks/useTabs';
import { SurfaceLauncher } from './SurfaceLauncher';

const Diff = lazy(() => import('~/components/diffs/DiffPanel').then((m) => ({ default: m.Diff })));

const PullRequestSurface = lazy(() =>
  import('~/components/pullRequest/PullRequestPanel').then((m) => ({
    default: m.PullRequestSurface,
  })),
);

const Browser = lazy(() =>
  import('~/components/preview/BrowserPanel').then((m) => ({ default: m.Browser })),
);

const Terminal = lazy(() => import('~/components/terminal/Terminal'));

const Editor = lazy(() => import('~/components/editor/Editor'));

const icons = {
  terminal: TerminalSquare,
  diff: GitCompareArrows,
  pr: GitPullRequest,
  browser: Globe,
  file: FileCode2,
};

export default function RightPanel({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]),
    runs = useApp((a) => a.runs),
    [expanded, setExpanded] = useState(false);
  const active = view.surface,
    tabs = view.rightTabs ?? [];
  const tabStrip = useActiveTab(active ? surfaceKey(active) : '');
  const title = (s: Surface) =>
    s.kind === 'terminal'
      ? (runs.find((r) => r.id === s.id)?.name ?? 'Terminal')
      : s.kind === 'file'
        ? s.path.split('/').at(-1)
        : s.kind === 'pr'
          ? s.number
            ? '#' + s.number
            : 'Pull request'
          : s.kind === 'diff'
            ? 'Diff'
            : 'Preview';
  const close = (surface: Surface) => {
    const next = tabs.filter((s) => surfaceKey(s) !== surfaceKey(surface));
    useApp.getState().setView({
      rightTabs: next,
      surface: next.at(-1) ?? null,
      ...(next.length === 0 ? { changes: false } : {}),
    });
  };
  return (
    <section
      className={`right-surfaces ${expanded ? 'expanded' : ''}`}
      aria-label="Secondary surfaces"
    >
      <div className="surface-header">
        <div
          ref={tabStrip}
          className="surface-tabs"
          role="tablist"
          aria-label="Surfaces"
          onKeyDown={navigateTabs}
        >
          {tabs.map((s) => {
            const Icon = icons[s.kind];
            return (
              <div
                className={`surface-tab ${active && surfaceKey(active) === surfaceKey(s) ? 'active' : ''}`}
                key={surfaceKey(s)}
              >
                <button
                  role="tab"
                  aria-selected={!!active && surfaceKey(active) === surfaceKey(s)}
                  tabIndex={active && surfaceKey(active) === surfaceKey(s) ? 0 : -1}
                  aria-controls="secondary-surface-panel"
                  title={title(s)}
                  onClick={() => useApp.getState().setView({ surface: s })}
                >
                  <Icon size={13} />
                  <span>{title(s)}</span>
                </button>
                <button
                  className="tab-close"
                  aria-label={`Close ${title(s)}`}
                  onClick={() => close(s)}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="tab-tools">
          <button
            className="icon-button"
            title="Open a surface"
            onClick={() => useApp.setState({ modal: { kind: 'launcher' } })}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-button"
            title="Expand surface"
            onClick={() => setExpanded(!expanded)}
          >
            <Maximize2 size={13} />
          </button>
          <button
            className="icon-button"
            title="Hide secondary surface"
            onClick={() => useApp.getState().setView({ surface: null })}
          >
            <Columns2 size={13} />
          </button>
        </div>
      </div>
      <div
        className="surface-panel"
        id="secondary-surface-panel"
        role="tabpanel"
        aria-label={active ? title(active) : 'Open a surface'}
      >
        <Suspense fallback={<div className="surface-empty">Opening surface…</div>}>
          {active?.kind === 'terminal' ? (
            <Terminal id={active.id} />
          ) : active?.kind === 'diff' ? (
            <Diff
              key={surfaceKey(active)}
              session={session}
              path={active.path}
              initialMode={active.mode}
            />
          ) : active?.kind === 'pr' ? (
            <PullRequestSurface
              key={surfaceKey(active)}
              session={session}
              number={active.number}
              repositoryId={active.repositoryId}
            />
          ) : active?.kind === 'browser' ? (
            <Browser url={active.url} />
          ) : active?.kind === 'file' ? (
            <Editor session={session} path={active.path} primary={false} />
          ) : (
            <SurfaceLauncher session={session} />
          )}
        </Suspense>
      </div>
    </section>
  );
}
