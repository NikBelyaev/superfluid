import { app, BrowserWindow, dialog, session } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { autoUpdater } from 'electron-updater';
import { DesktopUpdates } from '../updates/DesktopUpdates';
import { WorkspaceClient } from '../backend/WorkspaceClient';
import { BrowserView } from '../preview/BrowserView';
import { createMainWindow } from '../window/MainWindow';
import { registerAppScheme, installAppProtocol } from '../window/protocol';
import { installDesktopIpc } from '../ipc/DesktopIpc';
import { DesktopLifecycle } from './DesktopLifecycle';
import { installApplicationMenu } from './applicationMenu';

export function startDesktopApp(directory: string) {
  registerAppScheme();
  if (process.env.SF_DATA_DIR) app.setPath('userData', process.env.SF_DATA_DIR);
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }
  const devUrl =
    !app.isPackaged && process.env.SF_DEV_URL === 'http://127.0.0.1:5176'
      ? process.env.SF_DEV_URL
      : undefined;
  let window: BrowserWindow | undefined;
  let lifecycle: DesktopLifecycle | undefined;
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      installAppProtocol(join(directory, 'renderer'));
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      const backend = new WorkspaceClient(
        join(directory, 'backend.mjs'),
        app.getPath('userData'),
        (event) => {
          if (window && !window.isDestroyed()) window.webContents.send('workspace:event', event);
        },
        (code) => {
          if (!lifecycle?.isQuitting && window && !window.isDestroyed())
            window.webContents.send('workspace:event', {
              type: 'error',
              message: `Workspace backend stopped (${code}). Restart Superfluid to recover your last checkpoint.`,
            });
        },
      );
      await backend.ready;
      const project = app.commandLine.getSwitchValue('project');
      if (project) await backend.call('project.add', { path: project });
      window = createMainWindow(join(directory, 'preload.cjs'), devUrl);
      const preview = new BrowserView(window);
      lifecycle = new DesktopLifecycle(window, backend, preview);
      const updates = new DesktopUpdates(
        autoUpdater,
        app.getVersion(),
        app.getPath('userData'),
        process.env.SF_TEST
          ? 'Updates are disabled during tests.'
          : !app.isPackaged
            ? 'Updates are available in installed release builds.'
            : process.platform !== 'darwin' ||
                !existsSync(join(process.resourcesPath, 'app-update.yml'))
              ? 'This build does not have an update feed. Install a release from GitHub.'
              : '',
        (state) => {
          if (state.status === 'error') lifecycle?.cancelUpdate();
          if (window && !window.isDestroyed())
            window.webContents.send('desktop:update-state', state);
        },
        (install) => lifecycle!.quit(install),
      );
      await updates.initialize();
      installDesktopIpc(window, backend, preview, devUrl, updates);
      installApplicationMenu(window, lifecycle, updates);
      await window.loadURL(devUrl || 'superfluid://app/index.html');
      updates.start();
      app.once('will-quit', () => updates.stop());
    })
    .catch((error) => {
      dialog.showErrorBox('Superfluid could not start', String(error));
      if (lifecycle) lifecycle.exit();
      else app.quit();
    });
}
