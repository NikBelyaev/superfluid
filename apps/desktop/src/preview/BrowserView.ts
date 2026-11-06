import { BrowserWindow, WebContentsView } from 'electron';
import type { Bridge } from '@superfluid/contracts';
import { httpUrl } from '../shell/urls';

export class BrowserView {
  private view: WebContentsView | undefined;
  constructor(private window: BrowserWindow) {}
  async update(input: Parameters<Bridge['browser']>[0]) {
    if (!input.visible) {
      if (this.view) this.view.setVisible(false);
      return;
    }
    if (!this.view) {
      this.view = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: 'superfluid-preview',
        },
      });
      this.window.contentView.addChildView(this.view);
      this.view.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.view.webContents.on('will-navigate', (event, url) => {
        try {
          httpUrl(url);
        } catch {
          event.preventDefault();
        }
      });
      this.view.webContents.on('will-redirect', (event, url) => {
        try {
          httpUrl(url);
        } catch {
          event.preventDefault();
        }
      });
    }
    if (input.bounds) {
      const zoom = this.window.webContents.getZoomFactor();
      const b = {
          x: input.bounds.x * zoom,
          y: input.bounds.y * zoom,
          width: input.bounds.width * zoom,
          height: input.bounds.height * zoom,
        },
        area = this.window.getContentBounds();
      if (
        !(['x', 'y', 'width', 'height'] as const).every((k) => Number.isFinite(b[k])) ||
        b.x < 0 ||
        b.y < 0 ||
        b.width < 0 ||
        b.height < 0 ||
        b.x + b.width > area.width + 1 ||
        b.y + b.height > area.height + 1
      )
        throw new Error('Invalid preview bounds.');
      this.view.setBounds({
        x: Math.round(b.x),
        y: Math.round(b.y),
        width: Math.round(b.width),
        height: Math.round(b.height),
      });
    }
    this.view.setVisible(true);
    if (input.url) await this.view.webContents.loadURL(httpUrl(input.url));
  }
  close() {
    if (this.view) {
      this.view.webContents.close();
      this.view = undefined;
    }
  }
}
