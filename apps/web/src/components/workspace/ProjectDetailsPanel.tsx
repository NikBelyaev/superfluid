import { GitBranch, ChevronUp } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { ScriptsSection } from '~/components/scripts/ScriptsSection';
import { SourceControlSection } from '~/components/vcs/SourceControlSection';
import { ProcessesSection } from '~/components/terminal/ProcessesSection';
import { LineageSection } from '~/components/editor/LineageSection';
import { useApp } from '~/state/workspaceStore';
import { RepositoryBranch } from '~/components/vcs/RepositoryBranch';

export default function ProjectDetailsPanel({ session }: { session: Session }) {
  const collapsed = useApp((s) => s.views[session.id]?.islandCollapsed);
  const setCollapsed = (islandCollapsed: boolean) =>
    useApp.getState().setView({ islandCollapsed }, session.id);
  return (
    <div className={`island ${collapsed ? 'collapsed' : ''}`} aria-label="Project actions">
      {collapsed && (
        <button
          className="island-heading island-expand"
          title="Expand actions"
          aria-label="Expand actions"
          onClick={() => setCollapsed(false)}
        >
          <GitBranch size={16} />
          <strong>
            <RepositoryBranch sessionId={session.id} />
          </strong>
          <ChevronUp size={16} />
        </button>
      )}
      {!collapsed && (
        <>
          <ScriptsSection session={session} onCollapse={() => setCollapsed(true)} />
          <div className="island-scroll">
            <SourceControlSection key={session.id} session={session} />
            <ProcessesSection session={session} />
            <LineageSection session={session} />
          </div>
        </>
      )}
    </div>
  );
}
