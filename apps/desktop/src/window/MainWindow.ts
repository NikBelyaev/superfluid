import { BrowserWindow } from 'electron';

export function createMainWindow(preloadPath: string, devUrl: string | undefined) {
  const window = new BrowserWindow({
    width: 1512,
    height: 980,
    minWidth: 900,
    minHeight: 600,
    title: 'Superfluid',
    backgroundColor: '#f3f4f6',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      preload: preloadPath,
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

  return window;
}
