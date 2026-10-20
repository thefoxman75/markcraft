import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'

export type Page = 'overlay' | 'editor' | 'capture' | 'library' | 'recorder' | 'scroll' | 'picker' | 'player' | 'frame'

export function createWindow(page: Page, options: BrowserWindowConstructorOptions): BrowserWindow {
  const roleIcon = page === 'editor' ? 'icon-editor.png' : page === 'capture' ? 'icon-capture.png' : 'icon.png'
  const icon = app.isPackaged
    ? join(process.resourcesPath, roleIcon)
    : join(app.getAppPath(), 'build', roleIcon)
  const win = new BrowserWindow({
    show: false,
    icon,
    ...options,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      ...options.webPreferences
    }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
  // Links and window.open never navigate inside the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  return win
}

/** Options for frameless, always-on-top helper windows that float over other apps. */
export function floatingOptions(): BrowserWindowConstructorOptions {
  return {
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true
  }
}

export function pinOnTop(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}
