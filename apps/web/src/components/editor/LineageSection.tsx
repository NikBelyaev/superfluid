import { ArrowUpRight, ArrowLeft, ArrowRight } from 'lucide-react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';

export function LineageSection({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]);
  const go = (direction: number) => {
    const index = view.historyIndex + direction,
      target = view.history[index];
    if (!target) return;
    useApp.getState().setView({ historyIndex: index });
    void useApp.getState().openFile(target.path, target.line, target.column, false);
  };
  return (
    <div className="island-section lineage">
      <div className="section-label">
        <span>Lineage</span>
        <div>
          <button
            className="icon-button"
            title="Navigate back (Ctrl −)"
            disabled={view.historyIndex <= 0}
            onClick={() => go(-1)}
          >
            <ArrowLeft size={13} />
          </button>
          <button
            className="icon-button"
            title="Navigate forward"
            disabled={view.historyIndex >= view.history.length - 1}
            onClick={() => go(1)}
          >
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
      {view.history.length ? (
        view.history.slice(-3).map((item, index) => (
          <button
            className={`island-row ${view.historyIndex === Math.max(0, view.history.length - 3) + index ? 'current' : ''}`}
            key={`${item.path}:${item.line}:${index}`}
            title={`${item.path}:${item.line}`}
            onClick={() => {
              const n = view.history.lastIndexOf(item);
              useApp.getState().setView({ historyIndex: n });
              void useApp.getState().openFile(item.path, item.line, item.column, false);
            }}
          >
            <ArrowUpRight size={13} />
            <span>{item.label}</span>
            <small>:{item.line}</small>
          </button>
        ))
      ) : (
        <div className="lineage-empty">Jump to a definition to start a trail.</div>
      )}
    </div>
  );
}
