import { api } from '../common/api'

type Mode = 'region' | 'window' | 'screen' | 'scroll' | 'record'
let mode: Mode = 'region'
const names: Record<Mode, string> = { region: 'Region', window: 'Window', screen: 'Full Screen', scroll: 'Scrolling', record: 'Recording' }
const shortcuts: Partial<Record<Mode, string>> = { region: 'Ctrl+Shift+1', window: 'Ctrl+Shift+2', screen: 'Ctrl+Shift+3' }

function choose(next: Mode): void {
  mode = next
  document.querySelectorAll<HTMLElement>('.mode').forEach((el) => el.classList.toggle('selected', el.dataset.mode === mode))
  document.getElementById('selection-label')!.textContent = names[mode]
  document.querySelector('#capture small')!.textContent = shortcuts[mode] ?? ''
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    choose(button.dataset.mode as Mode)
    if (mode === 'scroll' || mode === 'record') void api.runCapture(mode)
  })
})
document.getElementById('capture')!.addEventListener('click', () => void api.runCapture(mode))
document.getElementById('library')!.addEventListener('click', () => void api.openLibrary())
document.getElementById('open-editor')!.addEventListener('click', () => void api.openEditor())
