import { Menu } from '@base-ui/react/menu';
import { Plus } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { Session } from '@superfluid/contracts';
import { useApp } from '~/state/workspaceStore';
import type { TabGroup } from '~/state/workspaceView';
import { surfaceActions } from './SurfaceLauncher';

export function NewSurfaceMenu({ session, group }: { session: Session; group: TabGroup }) {
  const menu = useApp((state) => state.surfaceMenu);
  const open = menu?.sessionId === session.id && menu.group === group && !menu.tabKey;
  const actions = surfaceActions(session, group);
  const chooseShortcut = (event: KeyboardEvent) => {
    if (!open || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing)
      return;
    const action = actions.find(
      (action) => action.shortcut.toLowerCase() === event.key.toLowerCase(),
    );
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    useApp.setState({ surfaceMenu: null });
    action.run();
  };
  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        if (next) useApp.setState({ surfaceMenu: { sessionId: session.id, group } });
        else if (open) useApp.setState({ surfaceMenu: null });
      }}
    >
      <Menu.Trigger
        className="icon-button new-tab"
        title="New tab"
        aria-label="New tab"
        onKeyDownCapture={chooseShortcut}
      >
        <Plus size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" align="start" sideOffset={4}>
          <Menu.Popup
            className="small-menu surface-menu"
            aria-label="New surface"
            onKeyDownCapture={chooseShortcut}
          >
            {actions.map(({ icon: Icon, label, shortcut, run }) => (
              <Menu.Item key={label} onClick={run}>
                <Icon size={14} />
                <span>{label}</span>
                <kbd>{shortcut}</kbd>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
