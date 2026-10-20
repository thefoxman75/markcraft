export type SelectMode = 'region' | 'record' | 'scroll'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Sent to each region-selection overlay (one per display). */
export interface OverlayInit {
  mode: SelectMode
  /** Frozen screenshot of this display, sized in device pixels. */
  imageDataUrl: string
  scaleFactor: number
}

/** Saved annotation document (.markcraft). */
export interface SnapDoc {
  format: 'markcraft'
  version: 1
  width: number
  height: number
  background: { dataUrl: string; left: number; top: number }
  objects: unknown[]
  /** Flattened, display-sized preview used by the Library and Recent strip. */
  thumbnail?: string
}

export type EditorInit =
  | { kind: 'image'; dataUrl: string; title: string; filePath?: string }
  | { kind: 'doc'; doc: SnapDoc; title: string; filePath: string }

/** Which part of which display a streaming window (recorder, scroll capture) should use. */
export interface StreamTarget {
  /** Selection in CSS pixels, relative to the display's top-left corner. */
  rect: Rect
  displaySize: Size
  scaleFactor: number
}

export interface RecorderInit extends StreamTarget {
  mic: boolean
  webcam: boolean
}

export interface WindowSource {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
}

export interface SaveRequest {
  png: string
  doc: SnapDoc
  defaultName: string
}

export interface LibraryItem {
  filePath: string
  name: string
  thumbnail: string
  modified: number
  kind: 'image' | 'document'
}

export type MenuCommand =
  | 'save'
  | 'saveAs'
  | 'copyImage'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomFit'
  | 'zoomActual'
  | 'ocr'
