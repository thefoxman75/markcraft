import type { DocState, EditorDoc } from './doc'

const LIMIT = 100

/** Snapshot-based undo/redo. Call commit() after each completed user action. */
export class History {
  private stack: string[] = []
  private index = -1
  private restoring = false
  onChange: () => void = () => undefined

  constructor(private readonly doc: EditorDoc) {}

  reset(): void {
    this.stack = []
    this.index = -1
    this.restoring = false
    this.onChange()
  }

  commit(): void {
    if (this.restoring) return
    const snap = JSON.stringify(this.doc.state())
    if (snap === this.stack[this.index]) return
    this.stack = this.stack.slice(0, this.index + 1)
    this.stack.push(snap)
    if (this.stack.length > LIMIT) this.stack.shift()
    this.index = this.stack.length - 1
    this.onChange()
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1
  }

  async undo(): Promise<void> {
    if (this.canUndo) await this.go(this.index - 1)
  }

  async redo(): Promise<void> {
    if (this.canRedo) await this.go(this.index + 1)
  }

  private async go(i: number): Promise<void> {
    this.restoring = true
    try {
      this.index = i
      await this.doc.restore(JSON.parse(this.stack[i]) as DocState)
    } finally {
      this.restoring = false
    }
    this.onChange()
  }
}
