import { BrowserWindow, dialog, Menu } from 'electron';
import { DesktopLifecycle } from './DesktopLifecycle';

export function installApplicationMenu(window: BrowserWindow, lifecycle: DesktopLifecycle) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Superfluid',
        submenu: [
          { role: 'about' },
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
