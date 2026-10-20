import {
  Circle,
  Ellipse,
  FabricImage,
  FabricObject,
  FabricText,
  Group,
  IText,
  Path,
  PencilBrush,
  Point,
  Rect,
  Shadow,
  type TPointerEventInfo
} from 'fabric'
import type { Rect as Box } from '../../shared/types'
import type { EditorDoc, SnapKind } from './doc'
import { blockSize, pixelate } from './redact'

export type ToolName =
  | 'move'
  | 'select'
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
  | 'crop'

export interface Style {
  color: string
  width: number
  fontSize: number
}

export interface SelectionStyle extends Partial<Style> {
  kind: SnapKind | 'mixed'
  count: number
  x: number
  y: number
  boundsWidth: number
  boundsHeight: number
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
const CROP_COLOR = '#e8590c'
const SOLID_REDACT = '#111111'

const shadow = () => new Shadow({ color: 'rgba(0,0,0,0.35)', blur: 6, offsetX: 0, offsetY: 2 })

const withAlpha = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Shaft plus a filled head, as one path, so arrows scale and move as a unit. */
export function arrowPathData(x1: number, y1: number, x2: number, y2: number, width: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = Math.max(14, width * 3.6)
  const spread = head * 0.62
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const bx = x2 - head * cos
  const by = y2 - head * sin
  const lx = bx + spread * sin
  const ly = by - spread * cos
  const rx = bx - spread * sin
  const ry = by + spread * cos
  // Stop the shaft inside the head so the round cap doesn't poke through the tip.
  const sx = x2 - head * 0.6 * cos
  const sy = y2 - head * 0.6 * sin
  return `M ${x1} ${y1} L ${sx} ${sy} M ${x2} ${y2} L ${lx} ${ly} L ${rx} ${ry} Z`
}

const kind = (o: FabricObject) => (o as FabricObject & { snapKind?: SnapKind }).snapKind

const objectColor = (o: FabricObject): string | undefined => {
  const k = kind(o)
  const value =
    k === 'step'
      ? (o as Group).getObjects()[0]?.fill
      : k === 'text' || k === 'highlight' || k === 'block'
        ? o.fill
        : o.stroke
  if (typeof value !== 'string') return undefined
  if (value.startsWith('#')) return value.toLowerCase()
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return undefined
  return `#${[match[1], match[2], match[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
}

const common = <T>(values: (T | undefined)[]): T | undefined => {
  const first = values[0]
  return first !== undefined && values.every((value) => value === first) ? first : undefined
}

export class Tools {
  tool: ToolName = 'arrow'
  private drag: { start: Point; obj: FabricObject | null } | null = null
  private cropBox: Rect | null = null
  private pixelSelection: FabricImage | null = null
  selectionShape: 'rect' | 'ellipse' = 'rect'
  onCommit: () => void = () => undefined
  onCropChange: (active: boolean) => void = () => undefined

  constructor(
    private readonly doc: EditorDoc,
    private readonly style: () => Style
  ) {
    const c = doc.canvas
    c.on('mouse:down', (o) => this.down(o))
    c.on('mouse:move', (o) => this.move(o))
    c.on('mouse:up', (o) => this.up(o))
    c.on('path:created', ({ path }) => {
      path.set({ snapKind: 'pen', perPixelTargetFind: true } as Partial<Path>)
      this.onCommit()
    })
    c.on('text:editing:exited', ({ target }) => {
      if (!(target as IText).text.trim()) c.remove(target)
      this.onCommit()
    })
  }

  setTool(tool: ToolName): void {
    if (this.tool === 'crop' && tool !== 'crop') this.cancelCrop()
    if (this.tool === 'select' && tool !== 'select' && this.pixelSelection) {
      this.pixelSelection = null
    }
    this.tool = tool
    const c = this.doc.canvas
    const { color, width } = this.style()
    c.isDrawingMode = tool === 'pen'
    if (tool === 'pen') {
      const brush = new PencilBrush(c)
      brush.color = color
      brush.width = width
      brush.decimate = 2
      c.freeDrawingBrush = brush
    }
    c.selection = tool === 'move'
    c.defaultCursor = tool === 'move' ? 'default' : tool === 'text' ? 'text' : 'crosshair'
    c.discardActiveObject()
    c.requestRenderAll()
  }

  /** Update the pen brush and restyle any selected annotations. */
  applyStyle(): void {
    const { color, width, fontSize } = this.style()
    const c = this.doc.canvas
    if (c.freeDrawingBrush) {
      c.freeDrawingBrush.color = color
      c.freeDrawingBrush.width = width
    }
    const selected = c.getActiveObjects()
    for (const o of selected) {
      switch (kind(o)) {
        case 'arrow':
          o.set({ stroke: color, fill: color })
          break
        case 'line':
        case 'rect':
        case 'ellipse':
        case 'pen':
          o.set({ stroke: color, strokeWidth: width })
          break
        case 'highlight':
          o.set({ fill: withAlpha(color, 0.4) })
          break
        case 'block':
          o.set({ fill: color })
          break
        case 'text':
          o.set({ fill: color, fontSize } as Partial<IText>)
          break
        case 'step':
          ;(o as Group).getObjects()[0].set({ fill: color })
          o.set({ dirty: true })
          break
      }
    }
    if (selected.length) {
      c.requestRenderAll()
      this.onCommit()
    }
  }

  /** Properties shared by the current selection, for the properties sidebar. */
  selectionStyle(): SelectionStyle | null {
    const selected = this.doc.canvas.getActiveObjects()
    if (!selected.length) return null
    const kinds = selected.map(kind)
    const selectedKind = common(kinds) ?? 'mixed'
    const bounds = this.doc.canvas.getActiveObject()!.getBoundingRect()
    return {
      kind: selectedKind,
      count: selected.length,
      x: Math.round(bounds.left),
      y: Math.round(bounds.top),
      boundsWidth: Math.round(bounds.width),
      boundsHeight: Math.round(bounds.height),
      color: common(selected.map(objectColor)),
      width: common(
        selected.map((o) => {
          const k = kind(o)
          return k === 'line' || k === 'rect' || k === 'ellipse' || k === 'pen' ? Number(o.strokeWidth) : undefined
        })
      ),
      fontSize: common(selected.map((o) => (kind(o) === 'text' ? Number((o as IText).fontSize) : undefined)))
    }
  }

  private point(o: TPointerEventInfo): Point {
    return this.doc.canvas.getScenePoint(o.e)
  }

  private down(o: TPointerEventInfo): void {
    const tool = this.tool
    if (tool === 'move' || tool === 'pen') return
    if (tool === 'select' && this.pixelSelection) {
      if (o.target === this.pixelSelection) return
      this.doc.canvas.discardActiveObject()
      this.pixelSelection = null
    }
    // Clicking an existing annotation selects/moves it instead of drawing.
    if (tool !== 'select' && o.target && o.target !== this.doc.bg && o.target !== this.cropBox) return
    const p = this.point(o)
    if (tool === 'text') return this.addText(p)
    if (tool === 'step') return this.addStep(p)
    if (tool === 'crop' && this.cropBox) {
      this.doc.canvas.remove(this.cropBox)
      this.cropBox = null
    }
    this.drag = { start: p, obj: null }
  }

  private move(o: TPointerEventInfo): void {
    if (!this.drag) return
    const c = this.doc.canvas
    const { start } = this.drag
    const p = this.point(o)
    const { color, width } = this.style()
    const box: Box = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y)
    }
    let obj = this.drag.obj

    switch (this.tool) {
      case 'select':
        if (!obj) {
          const options = {
            fill: 'rgba(39,134,184,0.12)',
            stroke: '#2786b8',
            strokeWidth: 1,
            strokeDashArray: [6, 4],
            strokeUniform: true,
            excludeFromExport: true,
            evented: false
          }
          obj = this.selectionShape === 'ellipse'
            ? new Ellipse({ ...options, rx: 0, ry: 0 })
            : new Rect(options)
          c.add(obj)
        }
        if (obj instanceof Ellipse) obj.set({ left: box.x, top: box.y, rx: box.width / 2, ry: box.height / 2 })
        else obj.set({ left: box.x, top: box.y, width: box.width, height: box.height })
        break
      case 'arrow':
      case 'line': {
        // Paths can't be reshaped in place; rebuild while dragging.
        if (obj) c.remove(obj)
        const arrow = this.tool === 'arrow'
        obj = new Path(
          arrow ? arrowPathData(start.x, start.y, p.x, p.y, width) : `M ${start.x} ${start.y} L ${p.x} ${p.y}`,
          {
            stroke: color,
            fill: arrow ? color : '',
            strokeWidth: width,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            shadow: shadow(),
            perPixelTargetFind: true,
            snapKind: this.tool
          } as Partial<Path>
        )
        c.add(obj)
        break
      }
      case 'rect':
      case 'highlight':
      case 'redact':
      case 'block':
      case 'crop':
        if (!obj) {
          obj = new Rect(this.rectStyle(this.tool, color, width))
          c.add(obj)
        }
        obj.set({ left: box.x, top: box.y, width: box.width, height: box.height })
        break
      case 'ellipse':
        if (!obj) {
          obj = new Ellipse({
            fill: 'transparent',
            stroke: color,
            strokeWidth: width,
            strokeUniform: true,
            shadow: shadow(),
            perPixelTargetFind: true,
            snapKind: 'ellipse'
          } as Partial<Ellipse>)
          c.add(obj)
        }
        obj.set({ left: box.x, top: box.y, rx: box.width / 2, ry: box.height / 2 } as Partial<Ellipse>)
        break
    }
    if (obj) obj.setCoords()
    this.drag.obj = obj
    c.requestRenderAll()
  }

  private rectStyle(tool: ToolName, color: string, width: number): Partial<Rect> {
    switch (tool) {
      case 'highlight':
        return {
          fill: withAlpha(color, 0.4),
          strokeWidth: 0,
          globalCompositeOperation: 'multiply',
          snapKind: 'highlight'
        } as Partial<Rect>
      case 'redact':
        return { fill: 'rgba(0,0,0,0.25)', strokeWidth: 0, evented: false }
      case 'block':
        // Solid and fully opaque: nothing of what's underneath survives.
        return { fill: SOLID_REDACT, strokeWidth: 0, snapKind: 'block' } as Partial<Rect>
      case 'crop':
        return {
          fill: 'transparent',
          stroke: CROP_COLOR,
          strokeWidth: 2,
          strokeDashArray: [8, 6],
          strokeUniform: true,
          evented: false,
          excludeFromExport: true
        }
      default:
        return {
          fill: 'transparent',
          stroke: color,
          strokeWidth: width,
          strokeUniform: true,
          shadow: shadow(),
          perPixelTargetFind: true,
          snapKind: 'rect'
        } as Partial<Rect>
    }
  }

  private up(o: TPointerEventInfo): void {
    // Moves are handled once per frame, so a quick release can arrive before the
    // last one; finish the shape exactly where the button came up.
    if (this.drag) this.move(o)
    const drag = this.drag
    this.drag = null
    if (!drag?.obj) return
    const c = this.doc.canvas
    const obj = drag.obj
    const r = obj.getBoundingRect()
    if (r.width < 3 && r.height < 3) {
      c.remove(obj)
      return
    }
    if (this.tool === 'crop') {
      this.cropBox = obj as Rect
      this.onCropChange(true)
      return
    }
    if (this.tool === 'select') {
      void this.activatePixelSelection(obj as Rect | Ellipse)
      return
    }
    if (this.tool === 'redact') {
      c.remove(obj)
      void this.addRedaction({ x: obj.left, y: obj.top, width: obj.width, height: obj.height })
      return
    }
    c.setActiveObject(obj)
    c.requestRenderAll()
    this.onCommit()
  }

  private async addRedaction(box: Box): Promise<void> {
    const source = this.doc.backgroundPixels(box)
    const ctx = source.getContext('2d')!
    const pixels = ctx.getImageData(0, 0, source.width, source.height)
    const out = pixelate(pixels, blockSize(source.width, source.height))
    ctx.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0)
    // Encode once. An <img>-backed image reports its src as-is, whereas a
    // <canvas>-backed one re-encodes a PNG every time the document is snapshotted.
    const dataUrl = source.toDataURL('image/png')
    const img = await FabricImage.fromURL(dataUrl)
    img.set({ left: box.x, top: box.y, snapKind: 'redact', snapAsset: this.doc.addAsset(dataUrl) } as Partial<FabricImage>)
    this.doc.canvas.add(img)
    this.doc.canvas.setActiveObject(img)
    this.onCommit()
  }

  private addText(p: Point): void {
    const { color, fontSize } = this.style()
    const text = new IText('Text', {
      left: p.x,
      top: p.y - fontSize / 2,
      fontFamily: FONT,
      fontWeight: '600',
      fontSize,
      fill: color,
      shadow: shadow(),
      snapKind: 'text'
    } as Partial<IText>)
    const c = this.doc.canvas
    c.add(text)
    c.setActiveObject(text)
    text.enterEditing()
    text.selectAll()
    c.requestRenderAll()
  }

  private nextStepNumber(): number {
    let max = 0
    for (const o of this.doc.annotations()) {
      if (kind(o) !== 'step') continue
      const label = (o as Group).getObjects()[1] as FabricText | undefined
      max = Math.max(max, Number(label?.text) || 0)
    }
    return max + 1
  }

  private addStep(p: Point): void {
    const { color, width } = this.style()
    const radius = Math.max(16, width * 3.2)
    const n = this.nextStepNumber()
    const circle = new Circle({
      radius,
      left: p.x,
      top: p.y,
      originX: 'center',
      originY: 'center',
      fill: color,
      stroke: '#ffffff',
      strokeWidth: Math.max(2, radius / 8)
    })
    const label = new FabricText(String(n), {
      left: p.x,
      top: p.y,
      originX: 'center',
      originY: 'center',
      fontFamily: FONT,
      fontWeight: '700',
      fontSize: radius * (n > 9 ? 1.0 : 1.2),
      fill: '#ffffff'
    })
    const group = new Group([circle, label], { shadow: shadow(), snapKind: 'step' } as Partial<Group>)
    const c = this.doc.canvas
    c.add(group)
    c.setActiveObject(group)
    c.requestRenderAll()
    this.onCommit()
  }

  // ---- crop -------------------------------------------------------------------

  applyCrop(): void {
    const box = this.cropBox
    if (!box) return
    this.doc.canvas.remove(box)
    this.cropBox = null
    this.doc.crop({ x: box.left, y: box.top, width: box.width, height: box.height })
    this.onCropChange(false)
    this.onCommit()
  }

  cancelCrop(): void {
    if (!this.cropBox) return
    this.doc.canvas.remove(this.cropBox)
    this.cropBox = null
    this.doc.canvas.requestRenderAll()
    this.onCropChange(false)
  }

  get cropping(): boolean {
    return this.cropBox !== null
  }

  get hasPixelSelection(): boolean {
    return this.pixelSelection !== null
  }

  pixelSelectionData(): string | null {
    const box = this.pixelBox()
    return box ? this.doc.selectionPixels(box) : null
  }

  async deletePixelSelection(): Promise<boolean> {
    const box = this.pixelBox()
    if (!box) return false
    this.doc.canvas.remove(this.pixelSelection!)
    this.pixelSelection = null
    this.onCommit()
    return true
  }

  cropPixelSelection(): boolean {
    const box = this.pixelBox()
    if (!box) return false
    this.pixelSelection = null
    this.doc.crop(box)
    this.onCommit()
    return true
  }

  private pixelBox(): Box | null {
    if (!this.pixelSelection) return null
    return {
      x: this.pixelSelection.left,
      y: this.pixelSelection.top,
      width: this.pixelSelection.getScaledWidth(),
      height: this.pixelSelection.getScaledHeight()
    }
  }

  private async activatePixelSelection(guide: Rect | Ellipse): Promise<void> {
    const c = this.doc.canvas
    const box: Box = {
      x: guide.left,
      y: guide.top,
      width: guide.getScaledWidth(),
      height: guide.getScaledHeight()
    }
    const ellipse = guide instanceof Ellipse
    c.remove(guide)
    const source = this.doc.backgroundPixels(box)
    if (ellipse) {
      const clipped = document.createElement('canvas')
      clipped.width = source.width
      clipped.height = source.height
      const ctx = clipped.getContext('2d')!
      ctx.ellipse(clipped.width / 2, clipped.height / 2, clipped.width / 2, clipped.height / 2, 0, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(source, 0, 0)
      source.getContext('2d')!.clearRect(0, 0, source.width, source.height)
      source.getContext('2d')!.drawImage(clipped, 0, 0)
    }
    await this.doc.eraseBackground(box, ellipse)
    const image = await FabricImage.fromURL(source.toDataURL('image/png'))
    image.set({
      left: box.x,
      top: box.y,
      snapKind: 'pixel',
      snapAsset: this.doc.addAsset(source.toDataURL('image/png')),
      borderDashArray: [6, 4]
    } as Partial<FabricImage>)
    c.add(image)
    c.setActiveObject(image)
    image.setCoords()
    this.pixelSelection = image
    c.requestRenderAll()
    this.onCommit()
  }
}
