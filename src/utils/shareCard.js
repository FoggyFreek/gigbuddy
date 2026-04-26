import * as htmlToImage from 'html-to-image'

export const SHARE_LOGO = '/share/logo.png'

export const SHARE_PHOTOS = [
  { id: 'photo1', src: '/share/photos/photo1.jpg', label: 'Photo 1' },
  { id: 'photo2', src: '/share/photos/photo2.jpg', label: 'Photo 2' },
  { id: 'photo3', src: '/share/photos/photo3.jpg', label: 'Photo 3' },
  { id: 'photo4', src: '/share/photos/photo4.jpg', label: 'Photo 4' },
]

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
  const minutes = ((h * 60 + m - 30) % (24 * 60) + 24 * 60) % (24 * 60)
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
