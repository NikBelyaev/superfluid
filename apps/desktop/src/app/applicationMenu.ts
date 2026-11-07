import { BrowserWindow, dialog, Menu } from 'electron';
import { DesktopLifecycle } from './DesktopLifecycle';
import type { DesktopUpdates } from '../updates/DesktopUpdates';

export function installApplicationMenu(
  window: BrowserWindow,
  lifecycle: DesktopLifecycle,
  updates: DesktopUpdates,
) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Superfluid',
        submenu: [
          { role: 'about' },
          {
            label: 'Check for Updates…',
            click: () => {
              window.webContents.send('desktop:show-updates');
              void updates
                .run({ action: 'check' })
                .catch((error) => dialog.showErrorBox('Update failed', String(error)));
            },
          },
          { type: 'separator' },
          {
            label: 'Quit Superfluid',
            accelerator: 'CmdOrCtrl+Q',
            click: () => void lifecycle.quit(),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload workspace',
            click: async () => {
              try {
                window.setEnabled(false);
                await lifecycle.flushRenderer();
                window.webContents.reload();
              } catch (error) {
                dialog.showErrorBox('Reload cancelled', String(error));
              } finally {
                window.setEnabled(true);
              }
            },
          },
          { role: 'toggleDevTools' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
    ]),
  );
}
