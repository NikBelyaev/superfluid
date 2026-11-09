import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { useFileGitStatus } from '~/hooks/useFileGitStatus';
import { removeLineageEntry } from './lineage';
import { locationIcon } from './locationIcon';
import { fileLabelClassName } from '~/components/vcs/fileLabels';

export function LineageSection({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]);
  const getGitStatus = useFileGitStatus(session.id);
  const current = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' });
  }, [session.id, view.historyIndex, view.history.length]);
  const go = (index: number) => {
    const target = view.history[index];
    if (!target) return;
    useApp.getState().setView({ historyIndex: index }, session.id);
    void useApp
      .getState()
      .openFile(
        target.path,
        target.line,
        target.column,
        false,
        target.group,
        target.tab ? { tabKey: target.tab } : undefined,
      );
  };
  const remove = (index: number) => {
    const app = useApp.getState(),
      current = app.views[session.id],
      next = removeLineageEntry(current.history, current.historyIndex, index);
    app.setView(next, session.id);
    const target = next.history[next.historyIndex];
    if (index === current.historyIndex && target && app.sessionId === session.id)
      void app.openFile(
        target.path,
        target.line,
        target.column,
        false,
        target.group,
        target.tab ? { tabKey: target.tab } : undefined,
      );
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
            onClick={() => go(view.historyIndex - 1)}
          >
            <ArrowLeft size={13} />
          </button>
          <button
            className="icon-button"
            title="Navigate forward"
            disabled={view.historyIndex >= view.history.length - 1}
            onClick={() => go(view.historyIndex + 1)}
          >
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
      {view.history.length ? (
        <div className="lineage-list">
          {view.history.map((item, index) => {
            const Icon = locationIcon(item);
            const status = getGitStatus(item.path);
            return (
              <div className="lineage-row group/lineage" key={`${item.path}:${item.line}:${index}`}>
                <button
                  ref={view.historyIndex === index ? current : undefined}
                  className={`island-row font-normal group-hover/lineage:font-medium ${view.historyIndex === index ? 'current' : ''}`}
                  aria-current={view.historyIndex === index ? 'location' : undefined}
                  title={`${item.symbol ? `${item.symbol} — ` : ''}${item.path}:${item.line}`}
                  onClick={() => go(index)}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span
                    className={`tab-label ${fileLabelClassName(item.symbol ? undefined : status)}`}
                    data-git-status={item.symbol ? undefined : status}
                  >
                    {item.symbol ?? item.label}
                  </span>
                  <small
                    className={`tab-label min-w-0 max-w-[60%] truncate [font-weight:inherit] ${fileLabelClassName(item.symbol ? status : undefined, 'secondary')}`}
                    data-git-status={item.symbol ? status : undefined}
                  >
                    {item.symbol ? item.label : ''}:{item.line}
                  </small>
                </button>
                <button
                  className="lineage-remove"
                  aria-label={`Remove ${item.symbol ?? item.label} from Lineage`}
                  title="Remove from Lineage"
                  onClick={() => remove(index)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="lineage-empty">Jump to a definition to start a trail.</div>
      )}
    </div>
  );
}
