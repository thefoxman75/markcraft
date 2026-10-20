import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MenuCommand } from '../shared/types'
import {
  captureFullScreen,
  cropSelection,
  selectRegion,
  updateOverlayBounds,
  warmOverlays
} from './capture'
import { openCapture, openFileDialog, openPath } from './editor'
import { capturesDir, listCaptures, recordingsDir } from './library'
import { shutdownOcr } from './ocr'
import {
  handleMediaScheme,
  openWindowPicker,
  registerMediaScheme,
  startRecording,
  startScrollingCapture
} from './sessions'
import { getSettings, updateSettings, type Settings } from './settings'
import { installDisplayMediaHandler } from './streaming'
import { createTrayIcon } from './tray-icon'
import { createWindow } from './windows'

interface Action {
  label: string
  accelerator: string
  run: () => void | Promise<void>
}

const actions: Action[] = [
  { label: 'Capture Region…', accelerator: 'Control+Shift+1', run: captureRegion },
  { label: 'Capture Window…', accelerator: 'Control+Shift+2', run: openWindowPicker },
  { label: 'Capture Full Screen', accelerator: 'Control+Shift+3', run: captureScreen },
  { label: 'Scrolling Capture…', accelerator: 'Control+Shift+4', run: startScrollingCapture },
  { label: 'Record Screen…', accelerator: 'Control+Shift+5', run: startRecording }
]

async function captureRegion(): Promise<void> {
  const sel = await selectRegion('region')
  if (sel) openCapture(cropSelection(sel))
}

async function captureScreen(): Promise<void> {
  const image = await captureFullScreen()
  if (image) openCapture(image, 'Screen Capture')
}

let captureWindow: BrowserWindow | null = null
let libraryWindow: BrowserWindow | null = null

function showCaptureWindow(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.show()
    captureWindow.focus()
    return
  }
  captureWindow = createWindow('capture', {
    width: 680,
    height: 350,
    minWidth: 620,
    minHeight: 330,
    title: 'Markcraft Capture',
    backgroundColor: '#edf1f5'
  })
  captureWindow.once('ready-to-show', () => captureWindow?.show())
  captureWindow.on('closed', () => (captureWindow = null))
}

function showLibrary(): void {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    libraryWindow.show()
    libraryWindow.focus()
    return
  }
  libraryWindow = createWindow('library', {
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'Markcraft Library',
    backgroundColor: '#edf1f5'
  })
  libraryWindow.once('ready-to-show', () => libraryWindow?.show())
  libraryWindow.on('closed', () => (libraryWindow = null))
}

ipcMain.handle('capture:show', () => showCaptureWindow())
ipcMain.handle('library:show', () => showLibrary())
ipcMain.handle('library:list', (_e, limit?: number) => listCaptures(limit))
ipcMain.handle('library:open', (_e, filePath: string) => openPath(filePath))
ipcMain.handle('capture:run', async (_e, mode: string) => {
  if (mode === 'region') await captureRegion()
  else if (mode === 'window') await openWindowPicker()
  else if (mode === 'screen') await captureScreen()
  else if (mode === 'scroll') await startScrollingCapture()
  else if (mode === 'record') await startRecording()
})

const registered = new Set<string>()

function registerShortcuts(): void {
  for (const a of actions) {
    if (globalShortcut.register(a.accelerator, () => void a.run())) registered.add(a.accelerator)
    else console.warn(`Shortcut ${a.accelerator} is taken by another app`)
  }
}

function settingToggle(label: string, key: keyof Settings): MenuItemConstructorOptions {
  return {
    label,
    type: 'checkbox',
    checked: getSettings()[key],
    click: (item) => {
      updateSettings({ [key]: item.checked })
      refreshMenus()
    }
  }
}

function captureItems(): MenuItemConstructorOptions[] {
  return actions.map((a) => ({
    label: a.label,
    // Shown for reference; the global shortcut does the work.
    accelerator: registered.has(a.accelerator) ? a.accelerator : undefined,
    registerAccelerator: false,
    click: () => void a.run()
  }))
}

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    ...captureItems(),
    { type: 'separator' },
    { label: 'Open…', click: () => void openFileDialog() },
    { label: 'Show Captures Folder', click: () => void openFolder(capturesDir()) },
    { label: 'Show Recordings Folder', click: () => void openFolder(recordingsDir()) },
    { type: 'separator' },
    {
      label: 'Recording',
      submenu: [settingToggle('Record Microphone', 'mic'), settingToggle('Show Webcam', 'webcam')]
    },
    settingToggle('Auto-save Captures', 'autoSave'),
    { type: 'separator' },
    { label: 'About Markcraft', click: () => (process.platform === 'darwin' ? app.showAboutPanel() : void shell.openExternal(HOMEPAGE)) },
    { label: 'Open-Source Licenses', click: () => void openNotices() },
    { label: 'Quit Markcraft', role: 'quit' }
  ])
}

async function openFolder(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  await shell.openPath(dir)
}

/** Send a menu command to the focused editor window. */
const toEditor = (cmd: MenuCommand) => () =>
  BrowserWindow.getFocusedWindow()?.webContents.send('menu', cmd)

function appMenu(): Menu {
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CommandOrControl+O', click: () => void openFileDialog() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CommandOrControl+S', click: toEditor('save') },
        { label: 'Save As…', accelerator: 'CommandOrControl+Shift+S', click: toEditor('saveAs') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', click: toEditor('undo') },
        { label: 'Redo', accelerator: 'CommandOrControl+Shift+Z', click: toEditor('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Copy Image', accelerator: 'CommandOrControl+Shift+C', click: toEditor('copyImage') },
        { label: 'Grab Text (OCR)', accelerator: 'CommandOrControl+Shift+T', click: toEditor('ocr') }
      ]
    },
    { label: 'Capture', submenu: captureItems() },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: toEditor('zoomIn') },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: toEditor('zoomOut') },
        { label: 'Fit to Window', accelerator: 'CommandOrControl+9', click: toEditor('zoomFit') },
        { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: toEditor('zoomActual') },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Markcraft on GitHub', click: () => void shell.openExternal(HOMEPAGE) },
        { label: 'Report a Problem…', click: () => void shell.openExternal(`${HOMEPAGE}/issues`) },
        { type: 'separator' },
        { label: 'Open-Source Licenses', click: () => void openNotices() }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

const HOMEPAGE = 'https://github.com/lecrane54/markcraft'

/** Third-party license texts, shipped beside the app (see scripts/notices.cjs). */
async function openNotices(): Promise<void> {
  const file = app.isPackaged
    ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.txt')
    : join(app.getAppPath(), 'THIRD_PARTY_NOTICES.txt')
  await shell.openPath(file)
}

let tray: Tray | null = null

function refreshMenus(): void {
  tray?.setContextMenu(trayMenu())
  Menu.setApplicationMenu(appMenu())
}

const OPENABLE = /\.(markcraft|png|jpe?g|gif|webp|bmp)$/i

/** Image or .markcraft paths passed on the command line (Windows/Linux "Open with"). */
function fileArgs(argv: string[]): string[] {
  return argv.slice(1).filter((a) => OPENABLE.test(a) && existsSync(a))
}

// ---- App lifecycle ------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerMediaScheme()

  // Files opened via Finder before the app is ready are queued.
  const queued: string[] = []
  app.on('open-file', (e, filePath) => {
    e.preventDefault()
    if (app.isReady()) openPath(filePath)
    else queued.push(filePath)
  })

  app.whenReady().then(() => {
    app.setName('Markcraft')
    app.setAboutPanelOptions({
      applicationName: 'Markcraft',
      copyright: 'Copyright © 2026 Kyle Lefebvre. MIT License.',
      credits: 'Built with Electron, Fabric.js and Tesseract. Licenses: Help ▸ Open-Source Licenses.',
      website: HOMEPAGE
    })
    handleMediaScheme()
    installDisplayMediaHandler()
    registerShortcuts()
    tray = new Tray(createTrayIcon())
    tray.setToolTip('Markcraft')
    tray.on('click', showCaptureWindow)
    refreshMenus()
    warmOverlays()
    screen.on('display-added', warmOverlays)
    screen.on('display-removed', warmOverlays)
    screen.on('display-metrics-changed', updateOverlayBounds)
    const startupFiles = [...queued.splice(0), ...fileArgs(process.argv)]
    for (const p of startupFiles) openPath(p)
    if (!startupFiles.length) showCaptureWindow()
  })
  app.on('second-instance', (_e, argv) => fileArgs(argv).forEach(openPath))

  // Markcraft lives in the menu bar; closing every window doesn't quit it.
  app.on('window-all-closed', () => undefined)
  app.on('activate', () => {
    // Hidden capture overlays always exist, so look for visible windows.
    if (!BrowserWindow.getAllWindows().some((w) => w.isVisible())) showCaptureWindow()
  })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    void shutdownOcr()
  })
}
