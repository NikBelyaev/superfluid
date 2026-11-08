import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { WorkspaceClient } from '../backend/WorkspaceClient';
import { BrowserView } from '../preview/BrowserView';

export class DesktopLifecycle {
  private serial = 0;
  private quitting = false;
  private closing = false;
  private updateRequested = false;
  get isQuitting() {
    return this.quitting;
  }
  cancelUpdate() {
    this.updateRequested = false;
  }
  constructor(
    private window: BrowserWindow,
    private backend: WorkspaceClient,
    private preview: BrowserView,
  ) {
    window.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        void this.quit();
      }
    });
    app.on('before-quit', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        void this.quit();
      }
    });
  }
  async flushRenderer() {
    const id = ++this.serial;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        ipcMain.removeListener('workspace:flushed', ack);
        error ? reject(error) : resolve();
      };
      const ack = (event: Electron.IpcMainEvent, received: number, error: unknown) => {
        if (event.sender !== this.window.webContents || received !== id) return;
        finish(error ? new Error(String(error)) : undefined);
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              'Recovery did not acknowledge all edits. Keep this window open and save your files.',
            ),
          ),
        15000,
      );
      ipcMain.on('workspace:flushed', ack);
      this.window.webContents.send('workspace:flush', id);
    });
  }
  async quit(install?: () => void) {
    if (this.quitting || this.closing) return false;
    this.closing = true;
    let handedOff = false;
    try {
      const running = await this.backend
        .call('bootstrap', {})
        .then((x) => x.runs.filter((r) => r.state === 'running').length)
        .catch(() => 0);
      if (running && !this.updateRequested && !process.env.SF_TEST) {
        const answer = await dialog.showMessageBox(this.window, {
          type: 'question',
          message: `Stop ${running} running process${running === 1 ? '' : 'es'} and ${install ? 'restart to update' : 'quit'}?`,
          buttons: ['Keep working', install ? 'Stop and update' : 'Stop and quit'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response === 0) return false;
      }
      this.window.setEnabled(false);
      await this.flushRenderer();
      if (install) {
        // Squirrel may still fetch its payload; keep the workspace alive until native quit begins.
        this.updateRequested = true;
        this.window.setEnabled(true);
        this.closing = false;
        handedOff = true;
        install();
        return true;
      }
      await this.backend.call('shutdown', {});
      this.quitting = true;
      this.preview.close();
      this.backend?.kill();
      app.quit();
      return true;
    } catch (error) {
      this.updateRequested = false;
      handedOff = false;
      this.window.setEnabled(true);
      await dialog.showMessageBox(this.window, {
        type: 'error',
        message: 'Superfluid stayed open to protect your edits.',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['Keep working'],
      });
      return false;
    } finally {
      if (!handedOff) this.closing = false;
    }
  }
  exit() {
    this.quitting = true;
    app.quit();
  }
}
