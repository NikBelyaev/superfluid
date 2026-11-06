import {
  ArrowLeft,
  ArrowRight,
  Box,
  Braces,
  FileCode2,
  KeyRound,
  Package,
  SquareFunction,
  Tag,
  Variable,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { removeLineageEntry } from './lineage';

// LSP SymbolKind values.
const symbolIcons: Partial<Record<number, LucideIcon>> = {
  2: Package,
  3: Package,
  5: Box,
  6: Braces,
  7: Tag,
  9: Braces,
  12: SquareFunction,
  13: Variable,
  14: KeyRound,
};

export function LineageSection({ session }: { session: Session }) {
  const view = useApp((a) => a.views[session.id]);
  const current = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' });
  }, [session.id, view.historyIndex, view.history.length]);
  const go = (index: number) => {
    const target = view.history[index];
    if (!target) return;
    useApp.getState().setView({ historyIndex: index }, session.id);
    void useApp.getState().openFile(target.path, target.line, target.column, false);
  };
  const remove = (index: number) => {
    const app = useApp.getState(),
      current = app.views[session.id],
      next = removeLineageEntry(current.history, current.historyIndex, index);
    app.setView(next, session.id);
    const target = next.history[next.historyIndex];
    if (index === current.historyIndex && target && app.sessionId === session.id)
      void app.openFile(target.path, target.line, target.column, false);
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
            const Icon = symbolIcons[item.symbolKind ?? 0] ?? (item.symbol ? Braces : FileCode2);
            return (
              <div className="lineage-row" key={`${item.path}:${item.line}:${index}`}>
                <button
                  ref={view.historyIndex === index ? current : undefined}
                  className={`island-row ${view.historyIndex === index ? 'current' : ''}`}
                  aria-current={view.historyIndex === index ? 'location' : undefined}
                  title={`${item.symbol ? `${item.symbol} — ` : ''}${item.path}:${item.line}`}
                  onClick={() => go(index)}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span>{item.symbol ?? item.label}</span>
                  <small>
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
