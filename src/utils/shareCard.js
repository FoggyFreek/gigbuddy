import * as htmlToImage from 'html-to-image'
import jsPDF from 'jspdf'

export const SHARE_FORMATS = {
  square: { id: 'square', label: 'Square (1080×1080)', width: 1080, height: 1080 },
  story: { id: 'story', label: 'Story (1080×1920)', width: 1080, height: 1920 },
}

export const SHARE_VINTAGE_COLORS = [
  { id: 'mustard', label: 'Mustard', value: '#f5c542' },
  { id: 'rust', label: 'Rust', value: '#c8553d' },
  { id: 'red', label: 'Red', value: '#e3360f' },
  { id: 'sage', label: 'Sage', value: '#7a9e7e' },
  { id: 'teal', label: 'Teal', value: '#2d6e7e' },
  { id: 'cream', label: 'Cream', value: '#e8d5a8' },
  { id: 'orange', label: 'Orange', value: '#f5971e' },
]

export const SHARE_VARIATIONS = [
  { id: 'vintage', label: 'Vintage' },
  { id: 'minimal', label: 'Minimal' },
]

export const SHARE_STICKERS = [
  { id: 'just-announced', label: 'Just Announced!' },
  { id: 'coming-up', label: 'Coming Up!' },
]

export const SHARE_STICKER_POSITIONS = [
  { id: 'left-top', label: '↖' },
  { id: 'right-top', label: '↗' },
  { id: 'left-bottom', label: '↙' },
  { id: 'right-bottom', label: '↘' },
]

export function formatGigDateLong(gig) {
  if (!gig?.event_date) return ''
  return new Date(gig.event_date).toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function formatGigDateShort(gig) {
  if (!gig?.event_date) return ''
  const d = new Date(gig.event_date)
  return {
    weekday: d.toLocaleDateString('nl-NL', { weekday: 'long' }),
    day: d.toLocaleDateString('nl-NL', { day: '2-digit' }),
    month: d.toLocaleDateString('nl-NL', { month: 'long' }),
    year: d.toLocaleDateString('nl-NL', { year: 'numeric' }),
  }
}

export function formatGigTimeRange(gig) {
  const start = gig?.start_time ? String(gig.start_time).slice(0, 5) : null
  const end = gig?.end_time ? String(gig.end_time).slice(0, 5) : null
  if (!start) return ''
  return end ? `${start} – ${end}` : start
}

export function formatGigDoorsTime(gig) {
  if (!gig?.start_time) return ''
  const [h, m] = String(gig.start_time).slice(0, 5).split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const minutes = ((h * 60 + m - 15) % (24 * 60) + 24 * 60) % (24 * 60)
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

export function formatGigVenue(gig) {
  return [gig?.venue, gig?.city].filter(Boolean).join(', ')
}

export function formatGigVenueName(gig) {
  return gig?.venue || ''
}

export function formatGigCity(gig) {
  return gig?.city || ''
}

export async function renderNodeToBlob(node, { width, height }) {
  return htmlToImage.toBlob(node, {
    width,
    height,
    pixelRatio: 1,
    cacheBust: true,
    backgroundColor: '#000',
  })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function canCopyImageToClipboard() {
  return (
    typeof window !== 'undefined' &&
    typeof window.ClipboardItem !== 'undefined' &&
    !!navigator.clipboard?.write
  )
}

export async function copyBlobToClipboard(blob) {
  if (!canCopyImageToClipboard()) {
    throw new Error('Clipboard image copy not supported in this browser')
  }
  await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })])
}

export function formatGigRowDate(gig) {
  if (!gig?.event_date) return ''
  const d = new Date(gig.event_date)
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  const day = String(d.getDate()).padStart(2, '0')
  return `${mon} ${day}`
}

export function buildTourShareFilename(year, formatId) {
  return `tour-${year}-${formatId}.png`
}

export async function renderLayeredPdf(node, { width, height }) {
  // Collect unique layers in DOM order
  const seen = new Set()
  const layers = []
  for (const el of node.querySelectorAll('[data-pdf-layer]')) {
    const id = el.getAttribute('data-pdf-layer')
    if (!seen.has(id)) { seen.add(id); layers.push({ id, el }) }
  }

  const mmW = (width / 96) * 25.4
  const mmH = (height / 96) * 25.4
  const pdf = new jsPDF({
    orientation: height > width ? 'portrait' : 'landscape',
    unit: 'mm',
    format: [mmW, mmH],
  })

  // Determine scale from preview transform (card is CSS-scaled in dialog)
  const cardRect = node.getBoundingClientRect()
  const previewScale = cardRect.width / width

  for (const { id, el } of layers) {
    // Element bounds in 1080px card-space
    const r = el.getBoundingClientRect()
    const x = Math.round((r.left - cardRect.left) / previewScale)
    const y = Math.round((r.top - cardRect.top) / previewScale)
    const w = Math.round(r.width / previewScale)
    const h = Math.round(r.height / previewScale)
    if (w <= 0 || h <= 0) continue

    // Render full card with only this layer visible
    const styleEl = document.createElement('style')
    styleEl.textContent = `
      [data-pdf-layer] { visibility: hidden !important; }
      [data-pdf-layer="${id}"] { visibility: visible !important; }
      [data-share-frame] { background: transparent !important; }
    `
    document.head.appendChild(styleEl)
    await new Promise((r) => requestAnimationFrame(r))
    const fullPng = await htmlToImage.toPng(node, { width, height, pixelRatio: 1, cacheBust: true })
    document.head.removeChild(styleEl)

    // Crop to element bounds
    const img = new Image()
    img.src = fullPng
    await img.decode()
    const crop = document.createElement('canvas')
    crop.width = w
    crop.height = h
    crop.getContext('2d').drawImage(img, -x, -y)
    const croppedPng = crop.toDataURL('image/png')

    // Place at correct position in PDF
    const pdfX = (x / width) * mmW
    const pdfY = (y / height) * mmH
    pdf.addImage(croppedPng, 'PNG', pdfX, pdfY, (w / width) * mmW, (h / height) * mmH)
  }

  return pdf
}

export function downloadPdf(pdf, filename) {
  pdf.save(filename)
}

export function buildSharePdfFilename(gig, formatId) {
  const date = gig?.event_date ? String(gig.event_date).slice(0, 10) : 'gig'
  const slug = (gig?.event_description || gig?.venue || 'share')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'share'
  return `${date}-${slug}-${formatId}.pdf`
}

export function buildShareFilename(gig, formatId) {
  const date = gig?.event_date ? String(gig.event_date).slice(0, 10) : 'gig'
  const slug = (gig?.event_description || gig?.venue || 'share')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'share'
  return `${date}-${slug}-${formatId}.png`
}
