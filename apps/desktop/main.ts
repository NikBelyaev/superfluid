import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  net,
  shell,
  utilityProcess,
  WebContentsView,
  Menu,
  session,
} from 'electron';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { open, rename, lstat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';
import { requests, type Method } from '../../packages/contracts';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'superfluid',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
if (process.env.SF_DATA_DIR) app.setPath('userData', process.env.SF_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.exit(0);
let window: BrowserWindow,
  backend: ReturnType<typeof utilityProcess.fork>,
  browser: WebContentsView | undefined;
let serial = 0,
  quitting = false,
  closing = false;
const pending = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const devUrl =
  !app.isPackaged && process.env.SF_DEV_URL === 'http://127.0.0.1:5176'
    ? process.env.SF_DEV_URL
    : undefined;
app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
function trusted(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? '';
  if (
    event.sender !== window.webContents ||
    !(url.startsWith('superfluid://app/') || (devUrl && url.startsWith(devUrl + '/')))
  )
    throw new Error('This page cannot access the workspace.');
}
function call(method: string, input: unknown): Promise<any> {
  if (pending.size >= 128) return Promise.reject(new Error('Workspace queue is full.'));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error('Workspace operation timed out. Its result may need checking before retry.'),
      );
    }, 150000);
    pending.set(id, { resolve, reject, timer });
    backend.postMessage({ id, method, input });
  });
}
function httpUrl(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP or HTTPS URL without credentials.');
  return url.href;
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1512,
    height: 980,
    minWidth: 900,
    minHeight: 600,
    title: 'Superfluid',
    backgroundColor: '#f3f4f6',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (e, url) => {
    if (!(url.startsWith('superfluid://app/') || (devUrl && url.startsWith(devUrl))))
      e.preventDefault();
  });
  window.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      void appQuit();
    }
  });
  await window.loadURL(devUrl || 'superfluid://app/index.html');
}
async function flushRenderer() {
  const id = ++serial;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      ipcMain.removeListener('workspace:flushed', ack);
      error ? reject(error) : resolve();
    };
    const ack = (event: Electron.IpcMainEvent, received: number, error: unknown) => {
      if (event.sender !== window.webContents || received !== id) return;
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
    window.webContents.send('workspace:flush', id);
  });
}
async function appQuit() {
  if (quitting || closing) return;
  closing = true;
  try {
    const running = await call('bootstrap', {})
      .then((x) => x.runs.filter((r: any) => r.state === 'running').length)
      .catch(() => 0);
    if (running && !process.env.SF_TEST) {
      const answer = await dialog.showMessageBox(window, {
        type: 'question',
        message: `Stop ${running} running process${running === 1 ? '' : 'es'} and quit?`,
        buttons: ['Keep working', 'Stop and quit'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response === 0) return;
    }
    window.setEnabled(false);
    await flushRenderer();
    await call('shutdown', {});
    quitting = true;
    if (browser) {
      browser.webContents.close();
      browser = undefined;
    }
    backend?.kill();
    app.quit();
  } catch (error) {
    window.setEnabled(true);
    await dialog.showMessageBox(window, {
      type: 'error',
      message: 'Superfluid stayed open to protect your edits.',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['Keep working'],
    });
  } finally {
    closing = false;
  }
}
app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault();
    void appQuit();
  }
});
app
  .whenReady()
  .then(async () => {
    protocol.handle('superfluid', (request) => {
      const url = new URL(request.url),
        base = join(__dirname, 'renderer'),
        file = resolve(base, '.' + decodeURIComponent(url.pathname));
      const rel = relative(base, file);
      if (url.host !== 'app' || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
        return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    backend = utilityProcess.fork(join(__dirname, 'backend.mjs'), [app.getPath('userData')], {
      env: {
        ...process.env,
        PATH: `${process.env.PATH || '/usr/bin:/bin'}:/opt/homebrew/bin:/usr/local/bin`,
        SF_NODE_EXEC_PATH: process.execPath,
      },
      serviceName: 'Superfluid workspace',
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Workspace backend did not start.')), 15000);
      backend.on('message', (message) => {
        if (message.ready) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    backend.on('message', (message) => {
      if (message.event) {
        if (window && !window.isDestroyed())
          window.webContents.send('workspace:event', message.event);
        return;
      }
      const task = pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    });
    backend.on('exit', (code) => {
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error('Workspace backend stopped. Unsaved models remain in the editor.'));
      }
      pending.clear();
      if (!quitting && window && !window.isDestroyed())
        window.webContents.send('workspace:event', {
          type: 'error',
          message: `Workspace backend stopped (${code}). Restart Superfluid to recover your last checkpoint.`,
        });
    });
    ipcMain.handle('workspace', async (e, method: Method, input) => {
      trusted(e);
      if (!(method in requests) || Buffer.byteLength(JSON.stringify(input)) > 5 * 1024 * 1024)
        throw new Error('Invalid workspace request.');
      requests[method].parse(input);
      return call(method, input);
    });
    ipcMain.handle('choose-project', async (e) => {
      trusted(e);
      const answer = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      return answer.canceled ? null : call('project.add', { path: answer.filePaths[0] });
    });
    ipcMain.handle('choose-directory', async (e) => {
      trusted(e);
      const answer = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
      });
      return answer.canceled ? null : answer.filePaths[0];
    });
    ipcMain.handle('export-text', async (e, text, name) => {
      trusted(e);
      if (
        typeof text !== 'string' ||
        Buffer.byteLength(text) > 16 * 1024 * 1024 ||
        typeof name !== 'string' ||
        name.length > 200
      )
        throw new Error('Export supports text buffers up to 16 MiB.');
      const answer = await dialog.showSaveDialog(window, {
        defaultPath: basename(name || 'recovered.py'),
      });
      if (answer.canceled || !answer.filePath) return false;
      const target = answer.filePath,
        info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
      if (info && (!info.isFile() || info.nlink > 1))
        throw new Error('Choose a regular file, rather than a symbolic or hard link.');
      const temp = join(dirname(target), '.superfluid-export-' + randomUUID());
      let handle;
      try {
        handle = await open(temp, 'wx', info?.mode ?? 0o600);
        await handle.writeFile(text, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temp, target);
      } finally {
        if (handle) await handle.close();
        await unlink(temp).catch(() => {});
      }
      return true;
    });
    ipcMain.handle('trash', async (e, sessionId, path) => {
      trusted(e);
      if (!path) throw new Error('The worktree root cannot be deleted here.');
      const file = await call('files.resolve', { sessionId, path });
      await shell.trashItem(file);
    });
    ipcMain.handle('external', async (e, url) => {
      trusted(e);
      await shell.openExternal(httpUrl(url));
    });
    ipcMain.handle('browser', async (e, input) => {
      trusted(e);
      if (!input.visible) {
        if (browser) browser.setVisible(false);
        return;
      }
      if (!browser) {
        browser = new WebContentsView({
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'superfluid-preview',
          },
        });
        window.contentView.addChildView(browser);
        browser.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
        browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        browser.webContents.on('will-navigate', (event, url) => {
          try {
            httpUrl(url);
          } catch {
            event.preventDefault();
          }
        });
        browser.webContents.on('will-redirect', (event, url) => {
          try {
            httpUrl(url);
          } catch {
            event.preventDefault();
          }
        });
      }
      if (input.bounds) {
        const zoom = window.webContents.getZoomFactor();
        const b = {
            x: input.bounds.x * zoom,
            y: input.bounds.y * zoom,
            width: input.bounds.width * zoom,
            height: input.bounds.height * zoom,
          },
          area = window.getContentBounds();
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
        browser.setBounds({
          x: Math.round(b.x),
          y: Math.round(b.y),
          width: Math.round(b.width),
          height: Math.round(b.height),
        });
      }
      browser.setVisible(true);
      if (input.url) await browser.webContents.loadURL(httpUrl(input.url));
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Superfluid',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: 'Quit Superfluid', accelerator: 'CmdOrCtrl+Q', click: () => void appQuit() },
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
                  await flushRenderer();
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
    await ready;
    const initialProject = app.commandLine.getSwitchValue('project');
    if (initialProject) await call('project.add', { path: initialProject });
    await createWindow();
  })
  .catch((error) => {
    dialog.showErrorBox('Superfluid could not start', String(error));
    quitting = true;
    app.quit();
  });
