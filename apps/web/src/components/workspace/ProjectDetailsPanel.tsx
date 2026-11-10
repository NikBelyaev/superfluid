import { GitBranch, ChevronDown } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { ScriptsSection } from '~/components/scripts/ScriptsSection';
import { SourceControlSection } from '~/components/vcs/SourceControlSection';
import { ProcessesSection } from '~/components/terminal/ProcessesSection';
import { LineageSection } from '~/components/editor/LineageSection';
import { useApp } from '~/state/workspaceStore';
import { RepositoryBranch } from '~/components/vcs/RepositoryBranch';
import { AgentStatus } from '~/components/agents/AgentStatus';

export default function ProjectDetailsPanel({ session }: { session: Session }) {
  const collapsed = useApp((s) => s.views[session.id]?.islandCollapsed);
  const setCollapsed = (islandCollapsed: boolean) =>
    useApp.getState().setView({ islandCollapsed }, session.id);
  return (
    <div className="island-stack absolute top-[92px] right-[18px] z-15 flex max-h-[calc(100%_-_112px)] w-[var(--island-width)] max-w-[calc(100%_-_24px)] flex-col gap-2 [@container_editor_(max-width:560px)]:hidden [@media(max-width:1200px)]:right-3">
      <div
        className={`island relative min-h-0 ${collapsed ? 'collapsed' : ''}`}
        aria-label="Project actions"
      >
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
            <ChevronDown size={16} />
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
      <AgentStatus key={session.id} session={session} />
    </div>
  );
}
