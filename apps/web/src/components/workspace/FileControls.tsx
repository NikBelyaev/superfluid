import { BookOpenText, CodeXml } from 'lucide-react';
import { Tooltip } from '~/components/ui/Tooltip';
import { useApp } from '~/state/workspaceStore';
import { setTabGroup, surfaceKey, tabGroup, type TabGroup } from '~/state/workspaceView';
import type { FileSurface } from '~/state/fileChains';
import './fileControls.css';

export function FileControls({
  sessionId,
  group,
  tab,
}: {
  sessionId: string;
  group: TabGroup;
  tab: FileSurface;
}) {
  if (!/\.(md|markdown)$/i.test(tab.path)) return null;
  const Icon = tab.preview ? BookOpenText : CodeXml;
  return (
    <div className="file-controls" role="group" aria-label="File controls">
      <Tooltip
        content={tab.preview ? 'Show Markdown source' : 'Show Markdown preview'}
        side="bottom"
      >
        <button
          className="icon-button"
          aria-label="Toggle Markdown preview"
          aria-pressed={!!tab.preview}
          onClick={() => {
            const app = useApp.getState();
            const view = app.views[sessionId];
            const { tabs, active } = tabGroup(view, group);
            if (active?.kind !== 'file' || surfaceKey(active) !== surfaceKey(tab)) return;
            const updated = { ...active, preview: !active.preview };
            app.setView(
              setTabGroup(
                view,
                group,
                tabs.map((item) => (surfaceKey(item) === surfaceKey(tab) ? updated : item)),
                updated,
              ),
              sessionId,
            );
          }}
        >
          <Icon size={14} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
