import { lazy, Suspense } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Session } from '@superfluid/contracts';
import { useApp, surfaceKey } from '~/state/workspaceStore';
import { tabGroup, type TabGroup } from '~/state/workspaceView';
import { EditorTabs } from '~/components/workspace/EditorTabs';
import { dropFile } from '~/components/workspace/tabDrag';
import { SurfaceLauncher } from './SurfaceLauncher';
import { PullRequestSurface } from '~/components/pullRequest/PullRequestPanel';

const Diff = lazy(() => import('~/components/diffs/DiffPanel').then((m) => ({ default: m.Diff })));

const Browser = lazy(() =>
  import('~/components/preview/BrowserPanel').then((m) => ({ default: m.Browser })),
);
const Terminal = lazy(() => import('~/components/terminal/Terminal'));
const Editor = lazy(() => import('~/components/editor/Editor'));
const ProjectTree = lazy(() => import('~/components/sidebar/ProjectTree'));

export default function RightPanel({
  session,
  group = 'right',
}: {
  session: Session;
  group?: TabGroup;
}) {
  const view = useApp((a) => a.views[session.id]);
  const { active } = tabGroup(view, group);
  const target = useDroppable({
    id: `panel:${group}`,
    data: { sessionId: session.id, group, area: 'panel' },
  });
  return (
    <section
      ref={target.setNodeRef}
      className="right-surfaces"
      data-group={group}
      data-drop-target={target.isOver || undefined}
      aria-label={
        group === 'main'
          ? 'Main surface'
          : group === 'bottom'
            ? 'Bottom surfaces'
            : 'Secondary surfaces'
      }
      onDragOver={(event) => {
        if (event.dataTransfer.types.some((type) => type === 'application/superfluid-file'))
          event.preventDefault();
      }}
      onDrop={(event) => dropFile(event, session.id, group)}
    >
      <EditorTabs session={session} group={group} />
      <div
        className="surface-panel"
        id={group === 'main' ? 'primary-editor-panel' : group + '-surface-panel'}
        role="tabpanel"
      >
        <Suspense fallback={<div className="surface-empty">Opening surface…</div>}>
          {active?.kind === 'files' ? (
            <ProjectTree key={session.id} session={session} />
          ) : active?.kind === 'terminal' ? (
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
              key={session.id + surfaceKey(active)}
              session={session}
              number={active.number}
              request={active.ref}
              repositoryId={active.repositoryId}
              revealChecks={active.revealChecks}
            />
          ) : active?.kind === 'browser' ? (
            <Browser url={active.url} />
          ) : active?.kind === 'file' ? (
            <Editor
              session={session}
              path={active.path}
              group={group}
              tabKey={surfaceKey(active)}
            />
          ) : (
            <SurfaceLauncher session={session} group={group} />
          )}
        </Suspense>
      </div>
    </section>
  );
}
