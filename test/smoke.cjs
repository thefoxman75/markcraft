// Smoke test: open a generated image in the editor, draw with synthetic
// pointer input, check undo/redo, crop and save a .markcraft file (checking
// that redactions and the cropped-away area don't survive in it), and save a
// screenshot of the window.
// Usage: npm run build && npx electron test/smoke.cjs <out.png>
const { app, dialog, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const out = path.resolve(process.argv.pop() || 'smoke.png')
fs.rmSync(out, { force: true })
const W = 1200
const H = 700
const buf = Buffer.alloc(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const stripe = Math.floor(y / 40) % 2 ? 235 : 250
    buf[i] = stripe - (x % 120 < 2 ? 80 : 0) // B
    buf[i + 1] = stripe - 10 // G
    buf[i + 2] = stripe // R
    buf[i + 3] = 255
  }
}
const sample = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'markcraft-')), 'sample.png')
fs.writeFileSync(sample, nativeImage.createFromBitmap(buf, { width: W, height: H }).toPNG())
process.argv.push(sample)

const drawScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(800)
  const upper = document.querySelector('.upper-canvas')
  const box = upper.getBoundingClientRect()
  const scale = box.width / ${W}
  const at = (x, y) => ({ clientX: box.left + x * scale, clientY: box.top + y * scale })
  const fire = (type, x, y) =>
    (type === 'mousedown' ? upper : document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...at(x, y)
    }))
  const drag = async (x1, y1, x2, y2) => {
    fire('mousedown', x1, y1)
    for (let t = 1; t <= 8; t++) { fire('mousemove', x1 + (x2 - x1) * t / 8, y1 + (y2 - y1) * t / 8); await wait(10) }
    fire('mouseup', x2, y2)
    await wait(50)
  }
  const tool = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  tool('a'); await drag(150, 550, 420, 300)
  tool('r'); await drag(500, 120, 800, 300)
  tool('e'); await drag(860, 380, 1100, 560)
  tool('h'); await drag(120, 80, 420, 125)
  tool('b'); await drag(500, 420, 760, 520)
  tool('x'); await drag(900, 100, 1100, 200)
  tool('n'); await drag(560, 180, 560, 180); await drag(700, 240, 700, 240)
  tool('v')
  window.__drag = drag
  window.__tool = tool
  return document.title + ' | ' + document.getElementById('dims').textContent + ' | ' + document.getElementById('zoom-label').textContent
})()`

const canvasPixels = async (win) =>
  nativeImage.createFromDataURL(
    await win.webContents.executeJavaScript("document.querySelector('canvas.lower-canvas').toDataURL()")
  )

/**
 * Share of pixels that differ clearly between two renders. Restored shapes are
 * re-rasterised, so faint anti-aliasing and shadow edges differ by design
 * (up to ~0.06% on Windows); one missing step badge alone changes ~0.1%.
 */
// Crop applied before saving, in sample-image pixels.
const CROP = { x: 100, y: 50, width: 1050, height: 600 }

/** The saved file must hold no redaction layers and no pixels outside the crop or under a redaction. */
function verifySaved(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  const kinds = doc.objects.map((o) => o.snapKind)
  if (kinds.some((k) => k === 'redact' || k === 'block')) throw new Error(`redaction layers saved: ${kinds}`)
  for (const k of ['arrow', 'rect', 'ellipse', 'highlight', 'step']) {
    if (!kinds.includes(k)) throw new Error(`annotation lost on save: ${k}`)
  }
  const bg = nativeImage.createFromDataURL(doc.background.dataUrl)
  const size = bg.getSize()
  if (size.width !== CROP.width || size.height !== CROP.height || doc.width !== CROP.width || doc.height !== CROP.height) {
    throw new Error(`saved background is ${size.width}×${size.height}, expected the ${CROP.width}×${CROP.height} crop`)
  }
  const px = bg.toBitmap()
  // Interior of a sample-space box (with a margin for rounding at the edges).
  const each = (x0, y0, x1, y1, fn) => {
    for (let y = y0 + 6; y < y1 - 6; y++) {
      for (let x = x0 + 6; x < x1 - 6; x++) fn((y - CROP.y) * size.width + (x - CROP.x), y * W + x)
    }
  }
  let notSolid = 0
  each(900, 100, 1100, 200, (i) => (notSolid += px[i * 4] === 17 && px[i * 4 + 1] === 17 && px[i * 4 + 2] === 17 ? 0 : 1))
  if (notSolid) throw new Error(`${notSolid} pixels under the solid redaction aren't solid`)
  let original = 0
  let total = 0
  each(500, 420, 760, 520, (i, j) => {
    total++
    if (px[i * 4] === buf[j * 4] && px[i * 4 + 1] === buf[j * 4 + 1] && px[i * 4 + 2] === buf[j * 4 + 2]) original++
  })
  console.log(`saved .markcraft: ${size.width}×${size.height}, layers [${kinds.join(', ')}], ${((original / total) * 100).toFixed(1)}% of pixelated pixels match the original`)
  if (original / total > 0.2) throw new Error('pixelated area still matches the original')
}

function changedShare(a, b, threshold = 48) {
  const pa = a.toBitmap()
  const pb = b.toBitmap()
  let changed = 0
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]))
    if (d > threshold) changed++
  }
  return changed / (pa.length / 4)
}

app.on('browser-window-created', (_e, win) => {
  // Only the synthetic events below may reach the editor, never the real pointer.
  win.setIgnoreMouseEvents(true)
  win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`))
  win.webContents.once('did-finish-load', async () => {
    // Capture overlays are created hidden at startup; only drive the editor.
    if (!win.webContents.getURL().includes('editor.html')) return
    try {
      const pause = () => new Promise((r) => setTimeout(r, 250))
      let ready = false
      for (let i = 0; i < 40; i++) {
        ready = await win.webContents.executeJavaScript("Boolean(document.getElementById('dims').textContent)")
        if (ready) break
        await pause()
      }
      if (!ready) throw new Error('editor did not finish loading the sample image')
      // MouseEvent coordinates are whole CSS pixels. At fractional zoom, their
      // rounding can move the exact crop edge by a document pixel. Draw at 1:1.
      win.webContents.send('menu', 'zoomActual')
      let actualSize = false
      for (let i = 0; i < 20; i++) {
        actualSize = await win.webContents.executeJavaScript("document.getElementById('zoom-label').textContent === '100%'")
        if (actualSize) break
        await pause()
      }
      if (!actualSize) throw new Error('editor did not switch to actual-size zoom')
      console.log('editor:', await win.webContents.executeJavaScript(drawScript))
      // Undo the last three actions (two steps and the solid redaction), then redo them.
      await pause()
      const drawn = await canvasPixels(win)
      for (let i = 0; i < 3; i++) {
        win.webContents.send('menu', 'undo')
        await pause()
      }
      const undone = await canvasPixels(win)
      for (let i = 0; i < 3; i++) {
        win.webContents.send('menu', 'redo')
        await pause()
      }
      const redone = await canvasPixels(win)
      const afterUndo = changedShare(drawn, undone)
      const afterRedo = changedShare(drawn, redone)
      console.log(`undo/redo: undo changed ${(afterUndo * 100).toFixed(2)}% of pixels, redo left ${(afterRedo * 100).toFixed(3)}% different`)
      if (afterUndo < 0.001) throw new Error('undo did not remove the last actions')
      if (afterRedo > 0.0008) throw new Error('redo did not restore the drawing')

      // Crop, then Save As .markcraft through the real menu path (dialog stubbed).
      const saved = path.join(path.dirname(sample), 'saved.markcraft')
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved })
      await win.webContents.executeJavaScript(`(async () => {
        __tool('c')
        await __drag(${CROP.x}, ${CROP.y}, ${CROP.x + CROP.width}, ${CROP.y + CROP.height})
        __tool('Enter')
        await new Promise((r) => setTimeout(r, 200))
      })()`)
      win.webContents.send('menu', 'saveAs')
      for (let i = 0; i < 40 && !fs.existsSync(saved); i++) await pause()
      verifySaved(saved)
      await win.webContents.executeJavaScript("__tool('a')")
      await pause()
      fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG())
      console.log('screenshot:', out)
    } catch (err) {
      console.error('smoke failed:', err)
      process.exitCode = 1
    }
    app.exit(process.exitCode ?? 0)
  })
})

require('../out/main/index.js')
