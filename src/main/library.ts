import { app, nativeImage, type NativeImage } from 'electron'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { LibraryItem, SnapDoc } from '../shared/types'
import { getSettings } from './settings'

export const capturesDir = () => join(app.getPath('pictures'), 'Markcraft')
export const recordingsDir = () => join(app.getPath('videos'), 'Markcraft')

export function timestampName(prefix: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
}

/** Keep an original copy of a capture when auto-save is on. Returns the file path, if saved. */
export function autoSaveCapture(image: NativeImage, name: string): string | undefined {
  if (!getSettings().autoSave) return undefined
  const dir = capturesDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.png`)
  writeFileSync(file, image.toPNG())
  return file
}

const LIBRARY_FILE = /\.(markcraft|png|jpe?g|gif|webp|bmp)$/i

/** Saved captures, newest first, with small thumbnails suitable for renderer IPC. */
export function listCaptures(limit = 500): LibraryItem[] {
  const dir = capturesDir()
  mkdirSync(dir, { recursive: true })
  const items = readdirSync(dir)
    .filter((name) => LIBRARY_FILE.test(name))
    .map((name) => {
      const filePath = join(dir, name)
      try {
        const modified = statSync(filePath).mtimeMs
        const document = name.toLowerCase().endsWith('.markcraft')
        const image = document
          ? (() => {
              const doc = JSON.parse(readFileSync(filePath, 'utf8')) as SnapDoc
              return nativeImage.createFromDataURL(doc.thumbnail ?? doc.background.dataUrl)
            })()
          : nativeImage.createFromPath(filePath)
        if (image.isEmpty()) return null
        const size = image.getSize()
        const scale = Math.min(1, 240 / size.width, 150 / size.height)
        const thumb = scale < 1
          ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' })
          : image
        return {
          filePath,
          name,
          thumbnail: thumb.toDataURL(),
          modified,
          kind: document ? 'document' as const : 'image' as const
        }
      } catch {
        return null
      }
    })
    .filter((item): item is LibraryItem => item !== null)
    .sort((a, b) => b.modified - a.modified || Number(b.kind === 'document') - Number(a.kind === 'document'))
  const seen = new Set<string>()
  return items.filter((item) => {
    const stem = basename(item.name, extname(item.name)).toLowerCase()
    if (seen.has(stem)) return false
    seen.add(stem)
    return true
  }).slice(0, Math.max(1, limit))
}
