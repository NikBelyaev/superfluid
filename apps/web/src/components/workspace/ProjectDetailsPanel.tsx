import { GitBranch, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { Session } from '@superfluid/contracts';
import { ScriptsSection } from '~/components/scripts/ScriptsSection';
import { SourceControlSection } from '~/components/vcs/SourceControlSection';
import { ProcessesSection } from '~/components/terminal/ProcessesSection';
import { LineageSection } from '~/components/editor/LineageSection';

export default function ProjectDetailsPanel({ session }: { session: Session }) {
  const [collapsed, setCollapsed] = useState(false);
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
          <strong>{session.branch || 'Local workspace'}</strong>
          <ChevronUp size={16} />
        </button>
      )}
      {!collapsed && (
        <>
          <ScriptsSection session={session} onCollapse={() => setCollapsed(true)} />
          <div className="island-scroll">
            <SourceControlSection session={session} />
            <ProcessesSection session={session} />
            <LineageSection session={session} />
          </div>
        </>
      )}
    </div>
  );
}
