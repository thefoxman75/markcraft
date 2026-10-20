import { contextBridge, ipcRenderer } from 'electron'
import type {
  EditorInit,
  LibraryItem,
  MenuCommand,
  OverlayInit,
  Rect,
  RecorderInit,
  SaveRequest,
  SnapDoc,
  StreamTarget,
  WindowSource
} from '../shared/types'

const api = {
  // Region selection overlay
  onOverlayStart: (cb: (init: OverlayInit) => void): void => {
    ipcRenderer.on('overlay:start', (_e, init: OverlayInit) => cb(init))
  },
  onOverlayReset: (cb: () => void): void => {
    ipcRenderer.on('overlay:reset', () => cb())
  },
  overlayReady: (): void => ipcRenderer.send('overlay:ready'),
  overlayDone: (rect: Rect | null): void => ipcRenderer.send('overlay:done', rect),

  // Editor
  editorInit: (): Promise<EditorInit> => ipcRenderer.invoke('editor:init'),
  copyImage: (dataUrl: string): Promise<void> => ipcRenderer.invoke('clipboard:image', dataUrl),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:text', text),
  saveAs: (req: SaveRequest): Promise<string | null> => ipcRenderer.invoke('file:save-as', req),
  saveDoc: (filePath: string, doc: SnapDoc): Promise<void> =>
    ipcRenderer.invoke('file:save-doc', filePath, doc),
  ocr: (dataUrl: string): Promise<string> => ipcRenderer.invoke('ocr:recognize', dataUrl),
  onMenu: (cb: (cmd: MenuCommand) => void): void => {
    ipcRenderer.on('menu', (_e, cmd: MenuCommand) => cb(cmd))
  },

  // Capture window and library
  runCapture: (mode: 'region' | 'window' | 'screen' | 'scroll' | 'record'): Promise<void> =>
    ipcRenderer.invoke('capture:run', mode),
  openCaptureWindow: (): Promise<void> => ipcRenderer.invoke('capture:show'),
  openLibrary: (): Promise<void> => ipcRenderer.invoke('library:show'),
  libraryItems: (limit?: number): Promise<LibraryItem[]> => ipcRenderer.invoke('library:list', limit),
  openLibraryItem: (filePath: string): Promise<void> => ipcRenderer.invoke('library:open', filePath),

  // Screen recording
  recorderInit: (): Promise<RecorderInit> => ipcRenderer.invoke('recorder:init'),
  recordingBegin: (mimeType: string): Promise<void> => ipcRenderer.invoke('recorder:begin', mimeType),
  recordingChunk: (chunk: ArrayBuffer): Promise<void> => ipcRenderer.invoke('recorder:chunk', chunk),
  recordingFinish: (): Promise<void> => ipcRenderer.invoke('recorder:finish'),
  recordingCancel: (): void => ipcRenderer.send('recorder:cancel'),

  // Scrolling capture
  scrollInit: (): Promise<StreamTarget> => ipcRenderer.invoke('scroll:init'),
  scrollDone: (dataUrl: string | null): void => ipcRenderer.send('scroll:done', dataUrl),

  // Window capture picker
  pickerSources: (): Promise<WindowSource[]> => ipcRenderer.invoke('picker:sources'),
  pickerChoose: (id: string): Promise<boolean> => ipcRenderer.invoke('picker:choose', id),
  pickerDone: (dataUrl: string | null): void => ipcRenderer.send('picker:done', dataUrl),

  // Video player
  playerInit: (): Promise<{ filePath: string; url: string }> => ipcRenderer.invoke('player:init'),
  revealFile: (filePath: string): Promise<void> => ipcRenderer.invoke('file:reveal', filePath),
  saveVideoAs: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('file:save-video', filePath)
}

export type MarkcraftApi = typeof api

contextBridge.exposeInMainWorld('markcraft', api)
