import { Menu } from '@base-ui/react/menu';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { resolveLocationSymbol, useApp } from '~/state/workspaceStore';
import { surfaceKey, type TabGroup } from '~/state/workspaceView';
import type { FileSurface } from '~/state/fileChains';
import { documentPath } from '~/state/editor/Documents';
import { locationIcon } from '~/components/editor/locationIcon';

export function ChainTabMenu({
  sessionId,
  group,
  tab,
}: {
  sessionId: string;
  group: TabGroup;
  tab: FileSurface;
}) {
  const menu = useApp((state) => state.surfaceMenu);
  const history = useApp((state) => state.views[sessionId]?.history);
  const key = surfaceKey(tab),
    chain = tab.chain;
  if (!chain) return null;
  const open =
    menu?.sessionId === sessionId &&
    menu.group === group &&
    menu.tabKey === key &&
    menu.kind === 'chain';
  const root = documentPath(chain.entries[0]!.path).split('/').at(-1);
  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          useApp.setState({ surfaceMenu: { sessionId, group, tabKey: key, kind: 'chain' } });
          const paths = new Set<string>();
          for (const entry of chain.entries)
            if (!paths.has(entry.path)) {
              paths.add(entry.path);
              void resolveLocationSymbol(sessionId, entry);
            }
        } else if (open) useApp.setState({ surfaceMenu: null });
      }}
    >
      <Menu.Trigger
        className="chain-trigger"
        aria-label={`Navigation chain from ${root}`}
        title="Navigation chain"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span>{chain.entries.length}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" sideOffset={4} align="start">
          <Menu.Popup className="small-menu chain-menu" aria-label="Navigation chain">
            {chain.entries.map((entry, index) => {
              const item = entry.symbol
                ? entry
                : (history?.findLast(
                    (item) =>
                      item.path === entry.path &&
                      item.line === entry.line &&
                      item.column === entry.column &&
                      item.symbol,
                  ) ?? entry);
              const Icon = locationIcon(item);
              const filename = documentPath(entry.path).split('/').at(-1);
              return (
                <div className="chain-menu-row" role="none" key={index}>
                  <Menu.Item
                    title={`${item.symbol ? `${item.symbol} — ` : ''}${documentPath(entry.path)}:${entry.line}`}
                    aria-current={index === chain.index ? 'location' : undefined}
                    onClick={() =>
                      void useApp
                        .getState()
                        .openFile(entry.path, entry.line, entry.column, true, group, {
                          tabKey: key,
                        })
                    }
                  >
                    <Icon size={13} aria-hidden="true" />
                    <span>{item.symbol ?? filename}</span>
                    <small>
                      {item.symbol ? filename : ''}:{entry.line}
                    </small>
                  </Menu.Item>
                  <Menu.Item
                    className="chain-open-separate"
                    aria-label={`Open ${filename}:${entry.line} in separate tab`}
                    title="Open in separate tab"
                    onClick={() =>
                      void useApp
                        .getState()
                        .openFile(entry.path, entry.line, entry.column, true, group)
                    }
                  >
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Menu.Item>
                </div>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
