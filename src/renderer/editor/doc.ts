import { Canvas, FabricImage, FabricObject, util } from 'fabric'
import type { Rect, SnapDoc } from '../../shared/types'

export interface PixelMask {
  kind: 'rect' | 'ellipse' | 'polygon'
  points?: { x: number; y: number }[]
  bounds?: Rect
  inverted?: boolean
}

// Fabric 7 defaults to centre origins; every position in this editor is top-left based.
FabricObject.ownDefaults.originX = 'left'
FabricObject.ownDefaults.originY = 'top'
// Keep transform handles visible over both light and dark screenshots.
FabricObject.ownDefaults.borderColor = '#e8590c'
FabricObject.ownDefaults.borderScaleFactor = 2
FabricObject.ownDefaults.cornerColor = '#ffffff'
FabricObject.ownDefaults.cornerStrokeColor = '#e8590c'
FabricObject.ownDefaults.cornerStyle = 'circle'
FabricObject.ownDefaults.cornerSize = 12
FabricObject.ownDefaults.transparentCorners = false
FabricObject.ownDefaults.padding = 4

/** Custom properties persisted with each annotation. */
export const CUSTOM_PROPS = ['snapKind', 'snapAsset']

/** Prefix for image sources held in the asset table instead of inline. */
const ASSET_REF = 'asset:'

type SerializedObject = { snapKind?: string; snapAsset?: string; src?: string; [key: string]: unknown }

/** Pixelate and solid-box redactions, live or serialized. */
const isRedaction = (o: { snapKind?: string } | FabricObject) => {
  const kind = (o as { snapKind?: string }).snapKind
  return kind === 'redact' || kind === 'block'
}

export type SnapKind =
  | 'arrow'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'step'
  | 'highlight'
  | 'pen'
  | 'redact'
  | 'block'
  | 'pixel'

export interface DocState {
  width: number
  height: number
  bgLeft: number
  bgTop: number
  bgDataUrl: string
  objects: unknown[]
}

/**
 * The capture being edited: a locked background image plus annotation objects,
 * shown at `zoom` while all coordinates stay in image pixels.
 */
export class EditorDoc {
  readonly canvas: Canvas
  width = 1
  height = 1
  zoom = 1
  bg!: FabricImage
  onLayout: () => void = () => undefined
  /**
   * PNG data for image annotations (redactions), keyed by their snapAsset id.
   * Undo snapshots reference these instead of carrying a copy of every image each time.
   */
  private readonly assets = new Map<string, string>()

  constructor(el: HTMLCanvasElement) {
    this.canvas = new Canvas(el, {
      preserveObjectStacking: true,
      selectionColor: 'rgb(232 89 12 / 0.12)',
      selectionBorderColor: '#e8590c',
      uniformScaling: false,
      // Hollow shapes are hit only on their stroke; this keeps thin strokes easy to grab.
      targetFindTolerance: 8,
      enableRetinaScaling: true
    })
  }

  async loadImage(dataUrl: string): Promise<void> {
    this.clear()
    const bg = await FabricImage.fromURL(dataUrl)
    this.setBackground(bg, 0, 0)
    this.width = bg.width
    this.height = bg.height
  }

  async loadDoc(doc: SnapDoc): Promise<void> {
    this.clear()
    const bg = await FabricImage.fromURL(doc.background.dataUrl)
    this.setBackground(bg, doc.background.left, doc.background.top)
    this.width = doc.width
    this.height = doc.height
    await this.setAnnotations(doc.objects)
  }

  private clear(): void {
    this.canvas.discardActiveObject()
    for (const object of this.canvas.getObjects()) this.canvas.remove(object)
    this.assets.clear()
  }

  private setBackground(bg: FabricImage, left: number, top: number): void {
    bg.set({ left, top, selectable: false, evented: false, hoverCursor: 'default', objectCaching: false })
    this.bg = bg
    this.canvas.add(bg)
    this.canvas.sendObjectToBack(bg)
  }

  annotations(): FabricObject[] {
    // Transient guides (the crop box) are marked excludeFromExport and never saved.
    return this.canvas.getObjects().filter((o) => o !== this.bg && !o.excludeFromExport)
  }

  async setAnnotations(serialized: unknown[]): Promise<void> {
    for (const o of this.annotations()) this.canvas.remove(o)
    const objects = await util.enlivenObjects<FabricObject>(serialized as object[])
    for (const o of objects) this.canvas.add(o)
    this.canvas.requestRenderAll()
  }

  /** Snapshot for undo: image annotations are stored as asset references. */
  state(): DocState {
    return {
      width: this.width,
      height: this.height,
      bgLeft: this.bg.left,
      bgTop: this.bg.top,
      bgDataUrl: this.bg.getSrc(),
      objects: this.annotations().map((o) => {
        const json = o.toObject(CUSTOM_PROPS) as SerializedObject
        if (json.snapAsset && json.src) {
          if (!json.src.startsWith(ASSET_REF)) this.assets.set(json.snapAsset, json.src)
          json.src = ASSET_REF + json.snapAsset
        }
        return json
      })
    }
  }

  async restore(state: DocState): Promise<void> {
    this.canvas.discardActiveObject()
    this.width = state.width
    this.height = state.height
    if (this.bg.getSrc() !== state.bgDataUrl) {
      this.canvas.remove(this.bg)
      this.setBackground(await FabricImage.fromURL(state.bgDataUrl), state.bgLeft, state.bgTop)
    } else {
      this.bg.set({ left: state.bgLeft, top: state.bgTop })
      this.bg.setCoords()
    }
    await this.setAnnotations(this.inlineAssets(state.objects))
    this.applyZoom(this.zoom)
  }

  /** Register image data for a new image annotation; returns its asset id. */
  addAsset(dataUrl: string): string {
    const id = crypto.randomUUID()
    this.assets.set(id, dataUrl)
    return id
  }

  private inlineAssets(objects: unknown[]): unknown[] {
    return (objects as SerializedObject[]).map((o) =>
      o.snapAsset && o.src?.startsWith(ASSET_REF) ? { ...o, src: this.assets.get(o.snapAsset) ?? '' } : o
    )
  }

  /**
   * Self-contained document for saving. Nothing hidden in the editor survives
   * into the file: the background is cut to the cropped area and every
   * redaction is burned into it, so recipients can't move a redaction aside
   * or undo a crop to see the original.
   */
  toSnapDoc(): SnapDoc {
    const s = this.state()
    const redactions = this.annotations().filter(isRedaction)
    return {
      format: 'markcraft',
      version: 1,
      width: s.width,
      height: s.height,
      background: { dataUrl: this.bakedBackground(redactions), left: 0, top: 0 },
      objects: this.inlineAssets(s.objects.filter((o) => !isRedaction(o as SerializedObject))),
      thumbnail: this.thumbnail()
    }
  }

  /** A small flattened preview without selection handles for library surfaces. */
  private thumbnail(): string {
    const scale = Math.min(1, 240 / this.width, 150 / this.height)
    const active = this.canvas.getActiveObject()
    this.canvas.discardActiveObject()
    this.canvas.renderAll()
    const url = this.canvas.toDataURL({
      format: 'png',
      multiplier: scale / this.zoom,
      enableRetinaScaling: false
    })
    if (active) this.canvas.setActiveObject(active)
    this.canvas.requestRenderAll()
    return url
  }

  /** The visible background with redactions painted on, as a PNG data URL. */
  private bakedBackground(redactions: FabricObject[]): string {
    const out = document.createElement('canvas')
    out.width = this.width
    out.height = this.height
    const ctx = out.getContext('2d')!
    ctx.drawImage(this.bg.getElement() as CanvasImageSource, this.bg.left, this.bg.top)
    for (const o of redactions) {
      ctx.save()
      // Same transform Fabric renders with (object centre at the origin), so
      // moved, resized or rotated redactions land exactly where they appear.
      const [a, b, c, d, e, f] = o.calcTransformMatrix()
      ctx.transform(a, b, c, d, e, f)
      if (o instanceof FabricImage) {
        ctx.drawImage(o.getElement() as CanvasImageSource, -o.width / 2, -o.height / 2, o.width, o.height)
      } else {
        ctx.fillStyle = String(o.fill)
        ctx.fillRect(-o.width / 2, -o.height / 2, o.width, o.height)
      }
      ctx.restore()
    }
    return out.toDataURL('image/png')
  }

  /** Render the document at 1:1 image pixels with no selection handles. */
  flatten(): string {
    const active = this.canvas.getActiveObject()
    this.canvas.discardActiveObject()
    this.canvas.renderAll()
    const url = this.canvas.toDataURL({ format: 'png', multiplier: 1 / this.zoom, enableRetinaScaling: false })
    if (active) this.canvas.setActiveObject(active)
    this.canvas.requestRenderAll()
    return url
  }

  /** Pixels of the original background under `r` (document coordinates). */
  backgroundPixels(r: Rect): HTMLCanvasElement {
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(r.width))
    out.height = Math.max(1, Math.round(r.height))
    const ctx = out.getContext('2d')!
    ctx.drawImage(
      this.bg.getElement() as CanvasImageSource,
      r.x - this.bg.left,
      r.y - this.bg.top,
      r.width,
      r.height,
      0,
      0,
      out.width,
      out.height
    )
    return out
  }

  /** Flatten just a selected region, optionally clipped to an ellipse. */
  selectionPixels(r: Rect, ellipse = false): string {
    const active = this.canvas.getActiveObject()
    this.canvas.discardActiveObject()
    this.canvas.renderAll()
    const source = this.canvas.toCanvasElement(1 / this.zoom)
    if (active) this.canvas.setActiveObject(active)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(r.width))
    out.height = Math.max(1, Math.round(r.height))
    const ctx = out.getContext('2d')!
    if (ellipse) {
      ctx.ellipse(out.width / 2, out.height / 2, out.width / 2, out.height / 2, 0, 0, Math.PI * 2)
      ctx.clip()
    }
    ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  /** Flatten only the supplied objects, preserving transparency between disjoint areas. */
  objectSelectionPixels(r: Rect, selected: FabricObject[]): string {
    const keep = new Set(selected)
    const visibility = this.canvas.getObjects().map((object) => [object, object.visible] as const)
    for (const [object] of visibility) object.visible = keep.has(object)
    const dataUrl = this.selectionPixels(r)
    for (const [object, visible] of visibility) object.visible = visible
    this.canvas.requestRenderAll()
    return dataUrl
  }

  /** Original background pixels clipped to an arbitrary selection mask. */
  backgroundSelection(r: Rect, mask: PixelMask): HTMLCanvasElement {
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(r.width))
    out.height = Math.max(1, Math.round(r.height))
    const ctx = out.getContext('2d')!
    this.traceMask(ctx, mask, -r.x, -r.y, out.width, out.height, r)
    ctx.clip(mask.inverted ? 'evenodd' : 'nonzero')
    ctx.drawImage(
      this.bg.getElement() as CanvasImageSource,
      r.x - this.bg.left,
      r.y - this.bg.top,
      r.width,
      r.height,
      0,
      0,
      out.width,
      out.height
    )
    return out
  }

  /** Remove pixels from the background while leaving annotations editable. */
  async eraseBackground(r: Rect, ellipse = false, fill: 'transparent' | 'auto' = 'transparent'): Promise<void> {
    await this.eraseBackgroundMask(r, { kind: ellipse ? 'ellipse' : 'rect' }, fill)
  }

  /** Remove or fill pixels covered by an arbitrary selection mask. */
  async eraseBackgroundMask(r: Rect, mask: PixelMask, fill: 'transparent' | 'auto' = 'transparent'): Promise<void> {
    const out = document.createElement('canvas')
    out.width = this.width
    out.height = this.height
    const ctx = out.getContext('2d')!
    ctx.drawImage(this.bg.getElement() as CanvasImageSource, this.bg.left, this.bg.top)
    const sample = (x: number, y: number) => ctx.getImageData(
      Math.max(0, Math.min(out.width - 1, Math.round(x))),
      Math.max(0, Math.min(out.height - 1, Math.round(y))), 1, 1
    ).data
    const samples = [
      sample(r.x - 1, r.y + r.height / 2), sample(r.x + r.width, r.y + r.height / 2),
      sample(r.x + r.width / 2, r.y - 1), sample(r.x + r.width / 2, r.y + r.height)
    ]
    const average = samples.map((_, channel) => Math.round(samples.reduce((sum, pixel) => sum + pixel[channel], 0) / samples.length))
    ctx.globalCompositeOperation = fill === 'auto' ? 'source-over' : 'destination-out'
    if (fill === 'auto') ctx.fillStyle = `rgba(${average[0]},${average[1]},${average[2]},${average[3] / 255})`
    this.traceMask(ctx, mask, 0, 0, this.width, this.height, r)
    ctx.fill(mask.inverted ? 'evenodd' : 'nonzero')
    this.canvas.remove(this.bg)
    this.setBackground(await FabricImage.fromURL(out.toDataURL('image/png')), 0, 0)
    this.canvas.requestRenderAll()
  }

  private traceMask(
    ctx: CanvasRenderingContext2D,
    mask: PixelMask,
    offsetX: number,
    offsetY: number,
    outerWidth: number,
    outerHeight: number,
    box?: Rect
  ): void {
    const r = mask.bounds ?? box ?? { x: 0, y: 0, width: this.width, height: this.height }
    ctx.beginPath()
    if (mask.inverted) ctx.rect(0, 0, outerWidth, outerHeight)
    if (mask.kind === 'ellipse') {
      ctx.ellipse(
        r.x + offsetX + r.width / 2,
        r.y + offsetY + r.height / 2,
        r.width / 2,
        r.height / 2,
        0,
        0,
        Math.PI * 2
      )
      return
    }
    if (mask.kind === 'polygon' && mask.points?.length) {
      const [first, ...rest] = mask.points
      ctx.moveTo(first.x + offsetX, first.y + offsetY)
      for (const point of rest) ctx.lineTo(point.x + offsetX, point.y + offsetY)
      ctx.closePath()
      return
    }
    ctx.rect(r.x + offsetX, r.y + offsetY, r.width, r.height)
  }

  /** Shift everything so `r` becomes the new document bounds. */
  crop(r: Rect): void {
    const x = Math.round(Math.max(0, r.x))
    const y = Math.round(Math.max(0, r.y))
    const w = Math.round(Math.min(this.width - x, r.width))
    const h = Math.round(Math.min(this.height - y, r.height))
    if (w < 2 || h < 2) return
    this.canvas.discardActiveObject()
    for (const o of this.canvas.getObjects()) {
      o.set({ left: o.left - x, top: o.top - y })
      o.setCoords()
    }
    this.width = w
    this.height = h
    this.applyZoom(this.zoom)
  }

  /** Resize the document bounds, shifting its contents when the top or left edge moves. */
  resizeCanvas(width: number, height: number, shiftX: number, shiftY: number): void {
    this.width = Math.max(32, Math.round(width))
    this.height = Math.max(32, Math.round(height))
    if (shiftX || shiftY) {
      for (const o of this.canvas.getObjects()) {
        o.set({ left: o.left + shiftX, top: o.top + shiftY })
        o.setCoords()
      }
    }
    this.applyZoom(this.zoom)
  }

  applyZoom(zoom: number): void {
    this.zoom = Math.min(8, Math.max(0.05, zoom))
    this.canvas.setDimensions({
      width: Math.round(this.width * this.zoom),
      height: Math.round(this.height * this.zoom)
    })
    this.canvas.setZoom(this.zoom)
    this.canvas.requestRenderAll()
    this.onLayout()
  }

  fitZoom(availWidth: number, availHeight: number): number {
    return Math.min(1, availWidth / this.width, availHeight / this.height)
  }
}
