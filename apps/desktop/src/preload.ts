import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, Bridge, UpdateState } from '@superfluid/contracts';

const bridge: Bridge = {
  update: (input) => ipcRenderer.invoke('desktop:update', input),
  onShowUpdates: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('desktop:show-updates', handler);
    return () => ipcRenderer.removeListener('desktop:show-updates', handler);
  },
  onUpdate: (listener) => {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on('desktop:update-state', handler);
    return () => ipcRenderer.removeListener('desktop:update-state', handler);
  },
  call: (method, input) => ipcRenderer.invoke('workspace', method, input),
  onEvent: (listener) => {
    const handler = (_event: unknown, value: AppEvent) => listener(value);
    ipcRenderer.on('workspace:event', handler);
    return () => ipcRenderer.removeListener('workspace:event', handler);
  },
  onFlush: (listener) => {
    const handler = async (_event: unknown, id: number) => {
      try {
        await listener();
        ipcRenderer.send('workspace:flushed', id, null);
      } catch (error) {
        ipcRenderer.send(
          'workspace:flushed',
          id,
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    ipcRenderer.on('workspace:flush', handler);
    return () => ipcRenderer.removeListener('workspace:flush', handler);
  },
  chooseProject: () => ipcRenderer.invoke('choose-project'),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  exportText: (text, name) => ipcRenderer.invoke('export-text', text, name),
  trash: (sessionId, path) => ipcRenderer.invoke('trash', sessionId, path),
  copyFile: (sessionId, path) => ipcRenderer.invoke('copy-file', sessionId, path),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  external: (url) => ipcRenderer.invoke('external', url),
  browser: (input) => ipcRenderer.invoke('browser', input),
};

contextBridge.exposeInMainWorld('superfluid', bridge);
