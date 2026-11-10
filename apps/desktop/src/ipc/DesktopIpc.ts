import {
  BrowserWindow,
  clipboard,
  ClipboardItem,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { pathToFileURL } from 'node:url';
import {
  requests,
  updateRequest,
  type Input,
  type Method,
  type Bridge,
} from '@superfluid/contracts';
import type { DesktopUpdates } from '../updates/DesktopUpdates';
import { WorkspaceClient } from '../backend/WorkspaceClient';
import { BrowserView } from '../preview/BrowserView';
import { chooseProject, chooseDirectory, exportText } from '../shell/nativeFiles';
import { externalUrl } from '../shell/urls';

function trusted(event: IpcMainInvokeEvent, window: BrowserWindow, devUrl: string | undefined) {
  const url = event.senderFrame?.url ?? '';
  if (
    event.sender !== window.webContents ||
    !(url.startsWith('superfluid://app/') || (devUrl && url.startsWith(devUrl + '/')))
  )
    throw new Error('This page cannot access the workspace.');
}

export function installDesktopIpc(
  window: BrowserWindow,
  backend: WorkspaceClient,
  preview: BrowserView,
  devUrl: string | undefined,
  updates: DesktopUpdates,
) {
  ipcMain.handle('desktop:update', (event, input: unknown) => {
    trusted(event, window, devUrl);
    return updates.run(updateRequest.parse(input));
  });
  ipcMain.handle('workspace', async (event, method: Method, input: Input<Method>) => {
    trusted(event, window, devUrl);
    if (!(method in requests) || Buffer.byteLength(JSON.stringify(input)) > 5 * 1024 * 1024)
      throw new Error('Invalid workspace request.');
    requests[method].parse(input);
    return backend.call(method, input);
  });
  ipcMain.handle('choose-project', (event) => {
    trusted(event, window, devUrl);
    return chooseProject(window, backend);
  });
  ipcMain.handle('choose-directory', (event) => {
    trusted(event, window, devUrl);
    return chooseDirectory(window);
  });
  ipcMain.handle('export-text', (event, text: unknown, name: unknown) => {
    trusted(event, window, devUrl);
    return exportText(window, text, name);
  });
  ipcMain.handle('trash', async (event, sessionId: string, path: string) => {
    trusted(event, window, devUrl);
    if (!path) throw new Error('The worktree root cannot be deleted here.');
    const file = await backend.call('files.resolve', { sessionId, path });
    await shell.trashItem(file);
  });
  ipcMain.handle('copy-file', async (event, sessionId: string, path: string) => {
    trusted(event, window, devUrl);
    if (!path) throw new Error('Choose a file or folder.');
    const file = await backend.call('files.resolve', { sessionId, path });
    await clipboard.write([
      new ClipboardItem({
        'electron application/osclipboard;format="public.file-url"': pathToFileURL(file).href,
      }),
    ]);
  });
  ipcMain.handle('external', async (event, url: string) => {
    trusted(event, window, devUrl);
    await shell.openExternal(externalUrl(url));
  });
  ipcMain.handle('browser', (event, input: Parameters<Bridge['browser']>[0]) => {
    trusted(event, window, devUrl);
    return preview.update(input);
  });
}
