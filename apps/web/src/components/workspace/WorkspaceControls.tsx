import { PanelBottom, PanelRight } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { showSurface, useApp } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';
import { rightPanelVisible } from '~/state/workspaceView';

export function WorkspaceControls({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]);
  const rightOpen = rightPanelVisible(view);
  return (
    <div className="tab-tools workspace-controls">
      <button
        className="icon-button"
        title="Toggle terminal"
        aria-label="Toggle terminal"
        aria-pressed={!!view.bottomSurface}
        onClick={() => {
          if (view.bottomSurface) useApp.getState().setView({ bottomSurface: null }, session.id);
          else {
            const tab = view.bottomTabs.at(-1);
            if (tab) showSurface(tab, session.id, 'bottom');
            else void runAction(session);
          }
        }}
      >
        <PanelBottom size={14} />
      </button>
      <button
        className="icon-button"
        title="Toggle right panel"
        aria-label="Toggle right panel"
        aria-pressed={rightOpen}
        onClick={() =>
          useApp.getState().setView(
            {
              rightPanelOpen: !rightOpen,
              surface: view.surface ?? view.rightTabs.at(-1) ?? null,
            },
            session.id,
          )
        }
      >
        <PanelRight size={14} />
      </button>
    </div>
  );
}
