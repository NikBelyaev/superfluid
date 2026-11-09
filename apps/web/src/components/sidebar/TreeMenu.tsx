import { Menu } from '@base-ui/react/menu';
import { Copy, FolderPlus, Pencil, FilePlusCorner, Trash2 } from 'lucide-react';
import type { FileEntry } from '@superfluid/contracts';
import { trashFile } from '~/commands/files';
import { useApp } from '~/state/workspaceStore';
import { desktop } from '~/rpc/desktop';

export function TreeMenu({
  handle,
  sessionId,
  create,
  rename,
  submitting,
}: {
  handle: Menu.Handle<FileEntry>;
  sessionId: string;
  create: (parent: string, directory: boolean) => void;
  rename: (path: string) => void;
  submitting: boolean;
}) {
  return (
    <Menu.Root handle={handle}>
      {({ payload }) => (
        <Menu.Portal>
          <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
            <Menu.Popup
              className="small-menu"
              aria-label="File actions"
              finalFocus={() => !document.activeElement?.matches('.tree-name-input')}
            >
              {payload?.directory && (
                <>
                  <Menu.Item disabled={submitting} onClick={() => create(payload.path, false)}>
                    <FilePlusCorner size={14} />
                    New file
                  </Menu.Item>
                  <Menu.Item disabled={submitting} onClick={() => create(payload.path, true)}>
                    <FolderPlus size={14} />
                    New folder
                  </Menu.Item>
                  <Menu.Separator />
                </>
              )}
              <Menu.Item onClick={() => payload && rename(payload.path)}>
                <Pencil size={14} />
                Rename
              </Menu.Item>
              <Menu.Item
                onClick={() =>
                  payload &&
                  void desktop.copyFile(sessionId, payload.path).catch(useApp.getState().fail)
                }
              >
                <Copy size={14} />
                Copy
              </Menu.Item>
              <Menu.Item
                className="negative"
                onClick={() =>
                  payload && void trashFile(sessionId, payload.path).catch(useApp.getState().fail)
                }
              >
                <Trash2 size={14} />
                Delete
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      )}
    </Menu.Root>
  );
}
