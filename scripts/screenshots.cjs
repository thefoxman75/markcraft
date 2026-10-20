// Generates the README screenshots in docs/screenshots/ by driving the real app:
// a fictional sample page is "captured", opened in the editor, annotated with
// synthetic input, and the editor, OCR panel and selection overlay are captured.
// Needs no screen-recording permission (it only captures Markcraft's own windows).
// Usage: npm run build && npm run screenshots
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const OUT = path.join(__dirname, '../docs/screenshots')
const SAMPLE = path.join(__dirname, 'screenshot-sample.html')
const PRELOAD = path.join(__dirname, '../out/preload/index.js')
const WINDOW = { width: 1440, height: 900 }
const MAX_WIDTH = 1600
const TEST_PICTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'markcraft-pictures-'))
app.setPath('pictures', TEST_PICTURES)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function save(win, name) {
  let image = await win.webContents.capturePage()
  if (image.getSize().width > MAX_WIDTH) image = image.resize({ width: MAX_WIDTH, quality: 'best' })
  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, image.toPNG())
  console.log('wrote', path.relative(process.cwd(), file), image.getSize())
}

/** Render the sample page and return it as a PNG plus element boxes (CSS px). */
async function renderSample() {
  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: true, frame: false })
  win.setIgnoreMouseEvents(true)
  await win.loadFile(SAMPLE)
  await wait(300)
  const boxes = await win.webContents.executeJavaScript(`(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
    const rows = [...document.querySelectorAll('tr')]
    return {
      email: box(document.querySelector('.user')), // includes the 30px avatar
      heading: box(document.querySelector('h1')),
      button: box(document.querySelector('.new')),
      overdueRow: box(rows.find((r) => r.textContent.includes('Overdue'))),
      nav: [...document.querySelectorAll('nav div')].slice(0, 3).map(box),
      table: box(document.querySelector('table'))
    }
  })()`)
  const image = await win.webContents.capturePage()
  win.destroy()
  return { image, boxes }
}

/** In-page script that annotates the sample like a user would. */
const annotate = (b, scale) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(600)
  const upper = document.querySelector('.upper-canvas')
  const r = upper.getBoundingClientRect()
  // sample CSS px → image px → on-screen canvas px
  const k = r.width / ${b.imageWidth}
  const at = (x, y) => ({ clientX: r.left + x * ${scale} * k, clientY: r.top + y * ${scale} * k })
  const fire = (type, x, y) =>
    (type === 'mousedown' ? upper : document).dispatchEvent(
      new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...at(x, y) })
    )
  const drag = async (x1, y1, x2, y2) => {
    fire('mousedown', x1, y1)
    for (let t = 1; t <= 10; t++) { fire('mousemove', x1 + ((x2 - x1) * t) / 10, y1 + ((y2 - y1) * t) / 10); await wait(8) }
    fire('mouseup', x2, y2)
    await wait(120)
  }
  const click = (x, y) => drag(x, y, x, y)
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }))
  const deselect = () => key('Escape')
  const color = (c) => document.querySelector('.swatch[title="' + c + '"]').click()
  const range = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')) }

  range('width', 6)
  range('font-size', ${Math.round(17 * scale)})

  // highlight the heading
  color('#f2c94c'); key('h')
  await drag(${b.heading.x - 6}, ${b.heading.y + 4}, ${b.heading.x + 150}, ${b.heading.y + b.heading.h - 2})
  deselect()

  // box the overdue row
  color('#e03131'); key('r')
  await drag(${b.overdueRow.x - 4}, ${b.overdueRow.y - 3}, ${b.overdueRow.x + b.overdueRow.w + 4}, ${b.overdueRow.y + b.overdueRow.h + 3})
  deselect()

  // arrow to the New task button, with a label
  color('#e8590c'); key('a')
  const bx = ${b.button.x}, by = ${b.button.y + b.button.h / 2}
  await drag(bx - 250, by, bx - 12, by)
  deselect()
  key('t')
  await click(bx - 425, by)
  const ta = [...document.querySelectorAll('textarea')].find((t) => t.id !== 'ocr-text')
  ta.value = 'Add tasks here'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(80)
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
  await wait(120)

  // numbered steps beside the navigation
  key('n')
  ${b.nav.map((n) => `await click(${n.x + n.w - 20}, ${n.y + n.h / 2})`).join('\n  ')}

  // pixelate the email address
  key('b')
  await drag(${b.email.x - 6}, ${b.email.y - 4}, ${b.email.x + b.email.w - 34}, ${b.email.y + b.email.h + 4})

  key('v')
  await wait(300)
  return document.getElementById('dims').textContent
})()`

async function captureEditor(sample) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'markcraft-shots-')), 'Acme Projects.png')
  fs.writeFileSync(file, sample.image.toPNG())
  const library = path.join(TEST_PICTURES, 'Markcraft')
  fs.mkdirSync(library, { recursive: true })
  for (let i = 1; i <= 6; i++) {
    fs.writeFileSync(path.join(library, `Sample Capture ${i}.png`), sample.image.resize({ width: 480 + i * 35, quality: 'best' }).toPNG())
  }

  const editor = new Promise((resolve) =>
    app.on('browser-window-created', (_e, win) =>
      win.webContents.once('did-finish-load', () => {
        if (win.webContents.getURL().includes('editor.html')) resolve(win)
      })
    )
  )
  // Same path Finder uses to open a file in the app.
  app.emit('open-file', { preventDefault() {} }, file)
  const win = await editor
  win.setIgnoreMouseEvents(true)
  win.setSize(WINDOW.width, WINDOW.height)
  win.center()
  await wait(500)

  const scale = sample.image.getSize().width / 1280
  const dims = await win.webContents.executeJavaScript(
    annotate({ ...sample.boxes, imageWidth: sample.image.getSize().width }, scale)
  )
  console.log('annotated', dims)
  await save(win, 'editor')

  // Exercise a real canvas handle, then undo so the OCR screenshot retains
  // the same dimensions as the editor screenshot.
  const east = await win.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('.canvas-handle.e').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', ...east, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseMove', x: east.x + 48, y: east.y, button: 'left' })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: east.x + 48, y: east.y, button: 'left', clickCount: 1 })
  await wait(150)
  const resized = await win.webContents.executeJavaScript("document.getElementById('dims').textContent")
  if (resized === dims) throw new Error('canvas resize handle did not change the document dimensions')
  win.webContents.send('menu', 'undo')
  await wait(200)
  const restored = await win.webContents.executeJavaScript("document.getElementById('dims').textContent")
  if (restored !== dims) throw new Error(`undo restored ${restored}, expected ${dims}`)
  console.log('canvas resize:', dims, '→', resized, '→ undo', restored)

  win.webContents.send('menu', 'ocr')
  for (let i = 0; i < 60; i++) {
    await wait(250)
    const status = await win.webContents.executeJavaScript("document.getElementById('ocr-status').textContent")
    if (/words|No text/.test(status)) break
  }
  await wait(300)
  await save(win, 'ocr')

  const capture = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('capture.html'))
  if (!capture) throw new Error('capture window was not created')
  await save(capture, 'capture-window')
  await win.webContents.executeJavaScript('window.markcraft.openLibrary()')
  await wait(400)
  const libraryWin = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('library.html'))
  if (!libraryWin) throw new Error('library window was not created')
  await save(libraryWin, 'library')
  const editorCount = () => BrowserWindow.getAllWindows().filter((candidate) => candidate.webContents.getURL().includes('editor.html')).length
  if (editorCount() !== 1) throw new Error(`expected one editor before opening a library item, found ${editorCount()}`)
  await libraryWin.webContents.executeJavaScript(`window.markcraft.openLibraryItem(${JSON.stringify(path.join(library, 'Sample Capture 1.png'))})`)
  await wait(300)
  if (editorCount() !== 1) throw new Error(`library item created another editor; found ${editorCount()}`)
  if (!win.getTitle().includes('Sample Capture 1.png')) throw new Error(`existing editor did not load the library item: ${win.getTitle()}`)
  await libraryWin.webContents.executeJavaScript('window.markcraft.showEditor()')
  await wait(100)
  if (libraryWin.isVisible()) throw new Error('Back to Editor did not hide the library')
  console.log('single editor: library item reused the existing window; Back to Editor focused it')
  libraryWin.destroy()
  capture.destroy()
  win.destroy()
}

async function captureOverlay(sample) {
  const win = new BrowserWindow({
    ...WINDOW,
    useContentSize: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true }
  })
  win.setIgnoreMouseEvents(true)
  await win.loadFile(path.join(__dirname, '../out/renderer/overlay.html'))
  const ready = new Promise((r) => ipcMain.once('overlay:ready', r))
  win.webContents.send('overlay:start', {
    mode: 'region',
    imageDataUrl: `data:image/jpeg;base64,${sample.image.toJPEG(92).toString('base64')}`,
    scaleFactor: sample.image.getSize().width / WINDOW.width
  })
  await ready
  // Drag a selection over the task table, mid-gesture (no mouseup = no capture).
  const t = sample.boxes.table
  const k = WINDOW.width / 1280
  await win.webContents.executeJavaScript(`(async () => {
    const ev = (type, x, y) => window.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }))
    ev('mousedown', ${(t.x - 8) * k}, ${(t.y - 8) * k})
    for (let i = 1; i <= 10; i++) { ev('mousemove', ${(t.x - 8) * k} + ${(t.w + 16) * k} * i / 10, ${(t.y - 8) * k} + ${(t.h * 0.62) * k} * i / 10); await new Promise((r) => setTimeout(r, 10)) }
  })()`)
  await wait(300)
  await save(win, 'select-region')
  win.destroy()
}

app.whenReady().then(async () => {
  // Fail loudly rather than hang if a step never completes.
  setTimeout(() => {
    console.error('screenshots failed: timed out after 2 minutes')
    app.exit(1)
  }, 120_000).unref()
  try {
    fs.mkdirSync(OUT, { recursive: true })
    await wait(1500) // let the app finish starting (tray, overlay pool)
    const sample = await renderSample()
    await captureEditor(sample)
    await captureOverlay(sample)
  } catch (err) {
    console.error('screenshots failed:', err)
    process.exitCode = 1
  }
  app.exit()
})

require('../out/main/index.js')
