import { useRef } from 'react';
import { ChevronDown, ChevronUp, Play, Plus, Settings, Check } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import { useShallow } from 'zustand/react/shallow';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import { runAction } from '~/commands/runProjectAction';
import './scriptsMenu.css';

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
  const selectedId = useApp((a) => a.views[session.id]?.projectActionId);
  const selected = actions.find((action) => action.id === selectedId) || actions[0];
  const anchor = useRef<HTMLDivElement>(null);
  const add = () => useApp.setState({ modal: { kind: 'action' } });
  return (
    <div className="island-section action-row">
      <div className={`min-w-0 flex-1 ${selected ? 'split-action' : ''}`} ref={anchor}>
        <button
          className="island-row"
          title={selected ? `Run ${selected.name}` : 'Add project action'}
          onClick={() => (selected ? void runAction(session, selected) : add())}
        >
          {selected ? <Play size={14} /> : <Plus size={14} />}
          <span>{selected?.name || 'Add project action'}</span>
          {selected?.shortcut && (
            <kbd>{selected.shortcut.replace('Meta', '⌘').replace('Key', '')}</kbd>
          )}
        </button>
        {selected && (
          <Menu.Root>
            <Menu.Trigger className="split-menu-trigger" aria-label="Choose project action">
              <ChevronDown size={16} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                anchor={anchor}
                className="menu-positioner project-action-positioner"
                align="end"
                sideOffset={4}
              >
                <Menu.Popup className="small-menu project-action-menu">
                  {actions.map((action) => (
                    <div className="project-action-menu-row" key={action.id}>
                      <Menu.Item
                        className="project-action-choice"
                        onClick={() =>
                          useApp.getState().setView({ projectActionId: action.id }, session.id)
                        }
                      >
                        {action.id === selected.id ? <Check size={14} /> : <Play size={14} />}
                        <span>{action.name}</span>
                      </Menu.Item>
                      <Menu.Item
                        className="project-action-edit"
                        aria-label={`Edit ${action.name}`}
                        onClick={() => useApp.setState({ modal: { kind: 'action', action } })}
                      >
                        <Settings size={14} aria-hidden />
                      </Menu.Item>
                    </div>
                  ))}
                  <Menu.Item onClick={add}>
                    <Plus size={14} />
                    Add project action
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
      <button className="icon-button" title="Collapse actions" onClick={onCollapse}>
        <ChevronUp size={16} />
      </button>
    </div>
  );
}
