import {
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  type NativeImage
} from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { EditorInit, SaveRequest, SnapDoc } from '../shared/types'
import { autoSaveCapture, capturesDir, timestampName } from './library'
import { warmOcr } from './ocr'
import { createWindow } from './windows'

const pending = new Map<number, EditorInit>()
let editorWindow: BrowserWindow | null = null

export function openEditor(init: EditorInit, imageSize?: { width: number; height: number }): BrowserWindow {
  if (editorWindow && !editorWindow.isDestroyed()) {
    pending.set(editorWindow.webContents.id, init)
    editorWindow.setTitle(init.title)
    editorWindow.webContents.send('editor:load', init)
    editorWindow.show()
    editorWindow.focus()
    return editorWindow
  }
  const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  // Size the window to the capture (in points), within 85% of the screen.
  const sf = screen.getPrimaryDisplay().scaleFactor
  const want = imageSize
    ? { width: imageSize.width / sf + 80, height: imageSize.height / sf + 150 }
    : { width: 1100, height: 760 }
  const width = Math.round(Math.min(Math.max(want.width, 760), work.width * 0.85))
  const height = Math.round(Math.min(Math.max(want.height, 520), work.height * 0.85))
  const win = createWindow('editor', {
    width,
    height,
    x: Math.round(work.x + (work.width - width) / 2),
    y: Math.round(work.y + (work.height - height) / 2),
    minWidth: 640,
    minHeight: 420,
    title: init.title,
    backgroundColor: '#1e1f22'
  })
  editorWindow = win
  pending.set(win.webContents.id, init)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    // Grab Text is likely next; load the engine while the user looks at the capture.
    warmOcr()
  })
  const id = win.webContents.id
  win.on('closed', () => {
    pending.delete(id)
    if (editorWindow === win) editorWindow = null
  })
  return win
}

export function showEditor(): boolean {
  if (!editorWindow || editorWindow.isDestroyed()) return false
  editorWindow.show()
  editorWindow.focus()
  return true
}

/** Open a fresh capture in the editor, keeping an auto-saved original. */
export function openCapture(image: NativeImage, prefix = 'Capture'): void {
  const name = timestampName(prefix)
  const filePath = autoSaveCapture(image, name)
  openEditor({ kind: 'image', dataUrl: image.toDataURL(), title: name, filePath }, image.getSize())
}

export async function openFileDialog(): Promise<void> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images and Markcraft files', extensions: ['markcraft', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
    ]
  })
  if (canceled) return
  for (const p of filePaths) openPath(p)
}

export function openPath(filePath: string): void {
  const title = basename(filePath)
  try {
    if (extname(filePath).toLowerCase() === '.markcraft') {
      const doc = JSON.parse(readFileSync(filePath, 'utf8')) as SnapDoc
      if (doc.format !== 'markcraft') throw new Error('Not a Markcraft file')
      openEditor({ kind: 'doc', doc, title, filePath }, doc)
    } else {
      const image = nativeImage.createFromPath(filePath)
      if (image.isEmpty()) throw new Error('Unsupported or unreadable image')
      openEditor({ kind: 'image', dataUrl: image.toDataURL(), title, filePath }, image.getSize())
    }
  } catch (err) {
    dialog.showErrorBox('Couldn’t open file', `${filePath}\n\n${(err as Error).message}`)
  }
}

ipcMain.handle('editor:init', (e) => {
  const init = pending.get(e.sender.id)
  if (!init) throw new Error('Editor has no document')
  return init
})

ipcMain.handle('clipboard:image', async (_e, dataUrl: string) => {
  const png = nativeImage.createFromDataURL(dataUrl).toPNG()
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
})

ipcMain.handle('clipboard:text', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('clipboard:read-image', async () => {
  for (const item of await clipboard.read()) {
    const type = item.types.find((candidate) => candidate.startsWith('image/'))
    if (!type) continue
    const blob = await item.getType(type)
    if (!(blob instanceof Blob)) continue
    const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
    if (!image.isEmpty()) return image.toDataURL()
  }
  return null
})

ipcMain.handle('file:save-as', async (e, req: SaveRequest) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const options = {
    defaultPath: `${capturesDir()}/${req.defaultName}.png`,
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
      { name: 'Markcraft (editable)', extensions: ['markcraft'] }
    ]
  }
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return null
  const ext = extname(filePath).toLowerCase()
  if (ext === '.markcraft') {
    writeFileSync(filePath, JSON.stringify(req.doc))
  } else {
    const image = nativeImage.createFromDataURL(req.png)
    writeFileSync(filePath, ext === '.jpg' || ext === '.jpeg' ? image.toJPEG(90) : image.toPNG())
  }
  return filePath
})

ipcMain.handle('file:save-doc', (_e, filePath: string, doc: SnapDoc) => {
  if (extname(filePath).toLowerCase() !== '.markcraft') throw new Error('Not a .markcraft path')
  writeFileSync(filePath, JSON.stringify(doc))
})

ipcMain.handle('file:auto-save-doc', (_e, sourcePath: string | null, title: string, doc: SnapDoc) => {
  mkdirSync(capturesDir(), { recursive: true })
  const sourceName = sourcePath ? basename(sourcePath, extname(sourcePath)) : title.replace(/\.[^.]+$/, '')
  const filePath = sourcePath?.toLowerCase().endsWith('.markcraft')
    ? sourcePath
    : join(capturesDir(), `${sourceName}.markcraft`)
  writeFileSync(filePath, JSON.stringify(doc))
  return filePath
})
