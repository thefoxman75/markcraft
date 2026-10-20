// 20×20 line icons drawn for Markcraft; stroke follows currentColor.
const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  move: svg('<path d="M5 3l10 6.5-4.5 1.2L8.3 15z"/>'),
  select: svg('<rect x="3.5" y="3.5" width="13" height="13" rx="1" stroke-dasharray="2.5 2.5"/>'),
  arrow: svg('<path d="M4 16L15 5"/><path d="M8.5 4.5H15.5V11.5"/>'),
  line: svg('<path d="M4 16L16 4"/>'),
  rect: svg('<rect x="3.5" y="5" width="13" height="10" rx="1.5"/>'),
  ellipse: svg('<ellipse cx="10" cy="10" rx="7" ry="5.2"/>'),
  text: svg('<path d="M4.5 5h11M10 5v11M7.5 16h5"/>'),
  step: svg('<circle cx="10" cy="10" r="7"/><path d="M9 7.5l1.5-1v7"/>'),
  highlight: svg('<path d="M4 15.5h12"/><path d="M6.5 12.5l6-8 3 2.2-6 8H6.5z"/>'),
  pen: svg('<path d="M3.5 16.5c2-1 2.5-4 5-4s2 3 4.5 2.5 3-4 3.5-6"/>'),
  redact: svg('<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M3.5 8h13M3.5 12.5h13M8 3.5v13M12.5 3.5v13"/>'),
  block: svg('<rect x="3.5" y="6" width="13" height="8" rx="1" fill="currentColor"/>'),
  crop: svg('<path d="M6 2.5V14h11.5"/><path d="M2.5 6H14v11.5"/>'),
  undo: svg('<path d="M7 5L3.5 8.5 7 12"/><path d="M3.5 8.5h8a4.5 4.5 0 010 9H9"/>'),
  redo: svg('<path d="M13 5l3.5 3.5L13 12"/><path d="M16.5 8.5h-8a4.5 4.5 0 000 9H11"/>'),
  ocr: svg('<path d="M3 6.5V4a1 1 0 011-1h2.5M13.5 3H16a1 1 0 011 1v2.5M17 13.5V16a1 1 0 01-1 1h-2.5M6.5 17H4a1 1 0 01-1-1v-2.5"/><path d="M7 7.5h6M10 7.5v5.5"/>'),
  copy: svg('<rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 6.5V4.5a1 1 0 00-1-1h-8a1 1 0 00-1 1v8a1 1 0 001 1h2"/>'),
  save: svg('<path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9"/><path d="M4 14v2.5h12V14"/>')
}
