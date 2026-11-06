import { BrowserWindow, dialog } from 'electron';
import { open, rename, lstat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceClient } from '../backend/WorkspaceClient';

export async function chooseProject(window: BrowserWindow, backend: WorkspaceClient) {
  const answer = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
  return answer.canceled ? null : backend.call('project.add', { path: answer.filePaths[0] });
}

export async function chooseDirectory(window: BrowserWindow) {
  const answer = await dialog.showOpenDialog(window, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return answer.canceled ? null : answer.filePaths[0];
}

export async function exportText(window: BrowserWindow, text: unknown, name: unknown) {
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
}
