import type { MenuCommand } from '../../shared/types'
import { api } from '../common/api'
import { EditorDoc } from './doc'
import { History } from './history'
import { icons } from './icons'
import { Tools, type SelectionStyle, type Style, type ToolName } from './tools'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const TOOLS: { name: ToolName; label: string; key: string }[] = [
  { name: 'select', label: 'Select', key: 'v' },
  { name: 'arrow', label: 'Arrow', key: 'a' },
  { name: 'line', label: 'Line', key: 'l' },
  { name: 'rect', label: 'Rectangle', key: 'r' },
  { name: 'ellipse', label: 'Ellipse', key: 'e' },
  { name: 'text', label: 'Text', key: 't' },
  { name: 'step', label: 'Step number', key: 'n' },
  { name: 'highlight', label: 'Highlight', key: 'h' },
  { name: 'pen', label: 'Pen', key: 'p' },
  { name: 'redact', label: 'Pixelate', key: 'b' },
  { name: 'block', label: 'Redact (solid box)', key: 'x' },
  { name: 'crop', label: 'Crop', key: 'c' }
]

const TOOL_LABELS = new Map(TOOLS.map((tool) => [tool.name, tool.label]))

const COLORS = ['#e8590c', '#e03131', '#f2c94c', '#2f9e44', '#1c7ed6', '#7048e8', '#111111', '#ffffff']

const style: Style = { color: COLORS[0], width: 5, fontSize: 36 }
const QUICK_STYLES: { label: string; color: string; width: number; fontSize: number }[] = [
  { label: 'Orange', color: '#e8590c', width: 5, fontSize: 36 },
  { label: 'Red bold', color: '#e03131', width: 8, fontSize: 44 },
  { label: 'Blue fine', color: '#1c7ed6', width: 3, fontSize: 30 },
  { label: 'Green', color: '#2f9e44', width: 5, fontSize: 36 },
  { label: 'Black', color: '#111111', width: 5, fontSize: 36 },
  { label: 'Yellow', color: '#f2c94c', width: 10, fontSize: 44 }
]
let filePath: string | null = null
let title = 'Markcraft'
let activeTool: ToolName = 'arrow'

const doc = new EditorDoc($<HTMLCanvasElement>('canvas'))
const history = new History(doc)
const tools = new Tools(doc, () => style)

// ---- toolbar ---------------------------------------------------------------------

const toolButtons = new Map<ToolName, HTMLButtonElement>()
for (const t of TOOLS) {
  const b = document.createElement('button')
  b.className = 'tool'
  b.innerHTML = `${icons[t.name]}<span class="tool-label">${t.label}</span>`
  b.title = `${t.label} (${t.key.toUpperCase()})`
  b.setAttribute('aria-label', t.label)
  b.addEventListener('click', () => selectTool(t.name))
  $('tools').append(b)
  toolButtons.set(t.name, b)
}

function selectTool(name: ToolName): void {
  activeTool = name
  tools.setTool(name)
  for (const [n, b] of toolButtons) b.setAttribute('aria-pressed', String(n === name))
  showProperties()
  updateProperties()
}

const swatches: HTMLButtonElement[] = []
for (const c of COLORS) {
  const b = document.createElement('button')
  b.className = 'swatch'
  b.style.background = c
  b.title = c
  b.addEventListener('click', () => setColor(c))
  $('swatches').append(b)
  swatches.push(b)
}
const custom = document.createElement('input')
custom.type = 'color'
custom.id = 'custom-color'
custom.title = 'Custom colour'
custom.addEventListener('input', () => setColor(custom.value))
$('swatches').append(custom)

function setColor(c: string): void {
  style.color = c
  custom.value = c
  swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(COLORS[i] === c)))
  tools.applyStyle()
  updatePropertyValues()
}

$<HTMLInputElement>('width').addEventListener('input', (e) => {
  style.width = Number((e.target as HTMLInputElement).value)
  tools.applyStyle()
  updatePropertyValues()
})
$<HTMLInputElement>('font-size').addEventListener('input', (e) => {
  style.fontSize = Number((e.target as HTMLInputElement).value)
  tools.applyStyle()
  updatePropertyValues()
})

const quickStyleButtons: HTMLButtonElement[] = []
for (const preset of QUICK_STYLES) {
  const button = document.createElement('button')
  button.className = 'quick-style'
  button.title = preset.label
  button.setAttribute('aria-label', preset.label)
  button.style.setProperty('--style-color', preset.color)
  button.style.setProperty('--style-width', `${Math.max(3, Math.min(12, preset.width))}px`)
  button.innerHTML = '<span aria-hidden="true"></span>'
  button.addEventListener('click', () => {
    style.color = preset.color
    style.width = preset.width
    style.fontSize = preset.fontSize
    syncInputs()
    tools.applyStyle()
    updatePropertyValues()
  })
  $('quick-styles').append(button)
  quickStyleButtons.push(button)
}

const actionButtons: Record<string, HTMLButtonElement> = {}
const primaryKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
const shiftKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⇧' : 'Shift+'
for (const [id, label, icon, run] of [
  ['undo', `Undo (${primaryKey}Z)`, icons.undo, () => history.undo()],
  ['redo', `Redo (${primaryKey}${shiftKey}Z)`, icons.redo, () => history.redo()],
  ['ocr', `Grab text (${primaryKey}${shiftKey}T)`, icons.ocr, grabText],
  ['copy', `Copy image (${primaryKey}C)`, icons.copy, copyImage],
  ['save', `Save As… (${primaryKey}${shiftKey}S)`, icons.save, saveAs]
] as const) {
  const b = document.createElement('button')
  b.className = 'tool'
  b.dataset.action = id
  b.innerHTML = `${icon}<span class="tool-label">${label.split(' (')[0]}</span>`
  b.title = label
  b.setAttribute('aria-label', label)
  b.addEventListener('click', () => void run())
  $('actions').append(b)
  actionButtons[id] = b
}

history.onChange = () => {
  actionButtons.undo.disabled = !history.canUndo
  actionButtons.redo.disabled = !history.canRedo
  updateProperties()
}

tools.onCommit = () => {
  history.commit()
  markDirty()
}
doc.canvas.on('object:modified', tools.onCommit)
doc.canvas.on('selection:created', updateProperties)
doc.canvas.on('selection:updated', updateProperties)
doc.canvas.on('selection:cleared', updateProperties)

tools.onCropChange = (active) => {
  $('crop-bar').hidden = !active
}
$('crop-apply').addEventListener('click', () => tools.applyCrop())
$('crop-cancel').addEventListener('click', () => tools.cancelCrop())

// ---- zoom & layout --------------------------------------------------------------

const stage = $('stage')

// ---- properties sidebar -------------------------------------------------------

const COLOR_TOOLS = new Set<ToolName>(['arrow', 'line', 'rect', 'ellipse', 'text', 'step', 'highlight', 'pen', 'block'])
const WIDTH_TOOLS = new Set<ToolName>(['arrow', 'line', 'rect', 'ellipse', 'step', 'pen'])
const FONT_TOOLS = new Set<ToolName>(['text'])

function showProperties(): void {
  $('properties-panel').hidden = false
  $('ocr-panel').hidden = true
}

function selectionTool(selection: SelectionStyle | null): ToolName | null {
  return selection?.kind && selection.kind !== 'mixed' ? (selection.kind as ToolName) : null
}

function syncInputs(): void {
  $<HTMLInputElement>('width').value = String(style.width)
  $<HTMLInputElement>('font-size').value = String(style.fontSize)
  custom.value = style.color
  swatches.forEach((button, i) => button.setAttribute('aria-pressed', String(COLORS[i] === style.color)))
}

function updatePropertyValues(): void {
  $('width-value').textContent = `${style.width} px`
  $('font-size-value').textContent = `${style.fontSize} px`
  quickStyleButtons.forEach((button, i) => {
    const preset = QUICK_STYLES[i]
    button.setAttribute(
      'aria-pressed',
      String(preset.color === style.color && preset.width === style.width && preset.fontSize === style.fontSize)
    )
  })
}

function updateProperties(): void {
  const selection = tools.selectionStyle()
  const selectedTool = selectionTool(selection)
  if (selection?.color) style.color = selection.color
  if (selection?.width !== undefined) style.width = selection.width
  if (selection?.fontSize !== undefined) style.fontSize = selection.fontSize
  syncInputs()
  updatePropertyValues()

  const effective = selectedTool ?? activeTool
  const mixed = selection?.kind === 'mixed'
  const fixedWidthSelection = selectedTool === 'arrow' || selectedTool === 'step'
  $('properties-title').textContent = selection
    ? selection.count > 1
      ? `${selection.count} annotations selected`
      : TOOL_LABELS.get(effective) ?? 'Annotation'
    : TOOL_LABELS.get(activeTool) ?? 'Tool'
  $('color-section').hidden = mixed || !COLOR_TOOLS.has(effective)
  $('width-section').hidden = mixed || !WIDTH_TOOLS.has(effective) || fixedWidthSelection
  $('font-size-section').hidden = mixed || !FONT_TOOLS.has(effective)
  $('quick-styles-section').hidden = mixed || !COLOR_TOOLS.has(effective)
  $('property-help').textContent = mixed
    ? 'Choose one kind of annotation at a time to edit its appearance.'
    : fixedWidthSelection
      ? 'Size is fixed after drawing. Color changes apply to the selected annotation.'
      : selection
        ? 'Changes apply to the selected annotation.'
        : effective === 'select' || effective === 'crop' || effective === 'redact'
          ? 'This tool has no appearance settings.'
          : 'These settings will be used for the next annotation.'
}

/** True until the user picks a zoom level; then window resizes stop refitting. */
let autoFit = true

function fit(): void {
  autoFit = true
  doc.applyZoom(doc.fitZoom(stage.clientWidth - 48, stage.clientHeight - 48))
}

function zoomTo(z: number): void {
  autoFit = false
  doc.applyZoom(z)
}

doc.onLayout = () => {
  $('zoom-label').textContent = `${Math.round(doc.zoom * 100)}%`
  $('dims').textContent = `${doc.width} × ${doc.height} px`
}

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8]
function zoomStep(dir: 1 | -1): void {
  const z = doc.zoom
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001)
  zoomTo(next ?? z)
}

$('zoom-in').addEventListener('click', () => zoomStep(1))
$('zoom-out').addEventListener('click', () => zoomStep(-1))
$('zoom-label').addEventListener('click', fit)

// ---- actions ----------------------------------------------------------------------

let messageTimer = 0
function flash(text: string): void {
  $('message').textContent = text
  clearTimeout(messageTimer)
  messageTimer = window.setTimeout(() => ($('message').textContent = ''), 2500)
}

function markDirty(): void {
  document.title = `${title} — edited`
}

function markSaved(path: string): void {
  filePath = path
  title = path.split(/[\\/]/).pop() ?? title
  document.title = title
}

async function copyImage(): Promise<void> {
  await api.copyImage(doc.flatten())
  flash('Image copied to clipboard')
}

async function saveAs(): Promise<void> {
  const saved = await api.saveAs({ png: doc.flatten(), doc: doc.toSnapDoc(), defaultName: baseName() })
  if (!saved) return
  // Only an editable .markcraft becomes this window's file; exports leave it as-is.
  if (saved.toLowerCase().endsWith('.markcraft')) markSaved(saved)
  flash(`Saved ${saved.split(/[\\/]/).pop()}`)
}

async function save(): Promise<void> {
  if (filePath?.toLowerCase().endsWith('.markcraft')) {
    await api.saveDoc(filePath, doc.toSnapDoc())
    markSaved(filePath)
    flash('Saved')
  } else {
    await saveAs()
  }
}

function baseName(): string {
  return title.replace(/\.[^.]+$/, '')
}

async function grabText(): Promise<void> {
  $('properties-panel').hidden = true
  $('ocr-panel').hidden = false
  const status = $('ocr-status')
  const area = $<HTMLTextAreaElement>('ocr-text')
  status.textContent = 'Recognising text…'
  area.value = ''
  try {
    const text = await api.ocr(doc.flatten())
    area.value = text
    status.textContent = text ? `${text.split(/\s+/).filter(Boolean).length} words` : 'No text found'
  } catch (err) {
    status.textContent = `Couldn’t read text: ${(err as Error).message}`
  }
  fit()
}

$('ocr-close').addEventListener('click', () => {
  $('ocr-panel').hidden = true
  $('properties-panel').hidden = false
  fit()
})
$('ocr-copy').addEventListener('click', async () => {
  await api.copyText($<HTMLTextAreaElement>('ocr-text').value)
  flash('Text copied to clipboard')
})

function deleteSelection(): void {
  const c = doc.canvas
  const selected = c.getActiveObjects()
  if (!selected.length) return
  c.discardActiveObject()
  for (const o of selected) c.remove(o)
  c.requestRenderAll()
  tools.onCommit()
}

// ---- keyboard & menu --------------------------------------------------------------

const editingText = () => {
  const active = doc.canvas.getActiveObject() as { isEditing?: boolean } | undefined
  const el = document.activeElement
  return Boolean(active?.isEditing) || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
}

window.addEventListener('keydown', (e) => {
  if (editingText()) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'backspace' || key === 'delete') {
    e.preventDefault()
    deleteSelection()
    return
  }
  if (key === 'enter' && tools.cropping) return tools.applyCrop()
  if (key === 'escape') {
    if (tools.cropping) return tools.cancelCrop()
    doc.canvas.discardActiveObject()
    doc.canvas.requestRenderAll()
    return
  }
  const tool = TOOLS.find((t) => t.key === key)
  if (tool) selectTool(tool.name)
})

// Edit ▸ Copy copies the whole annotated image unless text is being edited.
document.addEventListener('copy', (e) => {
  if (editingText()) return
  e.preventDefault()
  void copyImage()
})

const commands: Record<MenuCommand, () => unknown> = {
  save,
  saveAs,
  copyImage,
  undo: () => history.undo(),
  redo: () => history.redo(),
  zoomIn: () => zoomStep(1),
  zoomOut: () => zoomStep(-1),
  zoomFit: fit,
  zoomActual: () => zoomTo(1),
  ocr: grabText
}
api.onMenu((cmd) => void commands[cmd]?.())

// ---- startup ------------------------------------------------------------------------

async function start(): Promise<void> {
  const init = await api.editorInit()
  title = init.title
  document.title = title
  filePath = init.filePath ?? null
  if (init.kind === 'doc') await doc.loadDoc(init.doc)
  else await doc.loadImage(init.dataUrl)
  fit()
  history.commit()
  selectTool('arrow')
  setColor(style.color)
  new ResizeObserver(() => {
    // Refit on the next frame: resizing the canvas inside the callback would
    // trigger another observation in the same frame.
    requestAnimationFrame(() => {
      // A user zoom may have happened since this resize was queued.
      if (autoFit) fit()
    })
  }).observe(stage)
}

void start()
