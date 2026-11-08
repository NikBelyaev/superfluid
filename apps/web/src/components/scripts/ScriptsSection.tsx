import { ChevronUp, Play, Plus, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';

export function ScriptsSection({
  session,
  onCollapse,
}: {
  session: Session;
  onCollapse: () => void;
}) {
  const actions = useApp(
    useShallow((a) => a.actions.filter((x) => x.projectId === session.projectId)),
  );
  return (
    <div className="island-section">
      <div className="section-label">
        <span>Scripts</span>
        <div>
          <button
            className="icon-button"
            title="Add project action"
            onClick={() => useApp.setState({ modal: { kind: 'action' } })}
          >
            <Plus size={16} />
          </button>
          <button className="icon-button" title="Collapse actions" onClick={onCollapse}>
            <ChevronUp size={16} />
          </button>
        </div>
      </div>
      <div className="action-list">
        {actions.length ? (
          actions.map((action) => (
            <div className="action-row" key={action.id}>
              <button
                className="island-row"
                title={action.name}
                onClick={() => void runAction(session, action)}
              >
                <Play size={13} />
                <span>{action.name}</span>
                <kbd>{action.shortcut.replace('Meta', '⌘').replace('Key', '')}</kbd>
              </button>
              <button
                className="icon-button quiet"
                title={`Edit ${action.name}`}
                onClick={() => useApp.setState({ modal: { kind: 'action', action } })}
              >
                <Settings2 size={12} />
              </button>
            </div>
          ))
        ) : (
          <button
            className="island-row muted"
            onClick={() => useApp.setState({ modal: { kind: 'action' } })}
          >
            <Plus size={14} />
            <span>Add project action</span>
          </button>
        )}
      </div>
    </div>
  );
}
