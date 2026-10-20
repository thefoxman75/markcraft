// Renders build/icon.svg to build/icon.png (1024×1024), which electron-builder
// converts into .icns / .ico / Linux icon sizes.
// Usage: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 1024
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 })
  await win.loadURL('about:blank')
  for (const name of ['icon', 'icon-editor', 'icon-capture']) {
    const svg = fs.readFileSync(path.join(__dirname, `../build/${name}.svg`), 'utf8')
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))}
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = ${SIZE}
    c.getContext('2d').drawImage(img, 0, 0, ${SIZE}, ${SIZE})
    return c.toDataURL('image/png')
    })()`)
    const out = path.join(__dirname, `../build/${name}.png`)
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('wrote', out)
  }
  app.exit()
})
