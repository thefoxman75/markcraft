import type { LibraryItem } from '../../shared/types'
import { api } from '../common/api'

let items: LibraryItem[] = []
let filter: 'all' | 'images' | number = 'all'
let query = ''
const grid = document.getElementById('grid')!

function render(): void {
  grid.replaceChildren()
  const shown = items.filter((item) => {
    const matchesFilter = filter === 'all' || (filter === 'images' ? item.kind === 'image' : new Date(item.modified).getFullYear() === filter)
    return matchesFilter && item.name.toLowerCase().includes(query.toLowerCase())
  })
  document.getElementById('empty')!.hidden = shown.length > 0
  for (const item of shown) {
    const button = document.createElement('button')
    button.className = 'item'
    const thumb = document.createElement('div')
    thumb.className = 'thumb'
    const image = document.createElement('img')
    image.src = item.thumbnail
    image.alt = ''
    thumb.append(image)
    const name = document.createElement('strong')
    name.textContent = item.name
    const date = document.createElement('small')
    date.textContent = new Date(item.modified).toLocaleString()
    button.append(thumb, name, date)
    button.addEventListener('dblclick', () => void api.openLibraryItem(item.filePath))
    grid.append(button)
  }
}

async function load(): Promise<void> {
  items = await api.libraryItems()
  document.getElementById('count')!.textContent = String(items.length)
  const years = [...new Set(items.map((item) => new Date(item.modified).getFullYear()))]
  document.getElementById('years')!.replaceChildren(...years.map((year) => {
    const button = document.createElement('button')
    button.textContent = String(year)
    button.addEventListener('click', () => setFilter(year, button))
    return button
  }))
  render()
}

function setFilter(next: typeof filter, button: HTMLButtonElement): void {
  filter = next
  document.querySelectorAll<HTMLButtonElement>('aside button').forEach((item) => item.classList.toggle('selected', item === button))
  render()
}

document.getElementById('search')!.addEventListener('input', (event) => {
  query = (event.target as HTMLInputElement).value
  render()
})
document.getElementById('filter-all')!.addEventListener('click', (event) => setFilter('all', event.currentTarget as HTMLButtonElement))
document.getElementById('filter-images')!.addEventListener('click', (event) => setFilter('images', event.currentTarget as HTMLButtonElement))
document.getElementById('capture')!.addEventListener('click', () => void api.openCaptureWindow())
document.getElementById('back-editor')!.addEventListener('click', async () => {
  if (!(await api.showEditor()) && items.length) await api.openLibraryItem(items[0].filePath)
})
void load()
