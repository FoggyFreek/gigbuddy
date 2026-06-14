import type { Gig } from '../types/entities.ts'
import { venueHeadline, venueCity } from './venueDisplay.ts'

let shareCardFontCssPromise: Promise<string> | null = null
const ROBOTO_CONDENSED_CSS_URL = 'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&display=swap'

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

async function fetchFontDataUrl(path: string): Promise<string> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load font: ${path}`)
  return blobToDataUrl(await res.blob())
}

async function fetchCssFontFaces(cssUrl: string): Promise<string> {
  const cssRes = await fetch(cssUrl)
  if (!cssRes.ok) throw new Error(`Failed to load font CSS: ${cssUrl}`)
  let css = await cssRes.text()
  const fontUrls = [...css.matchAll(/url\(([^)]+)\)/g)]

  await Promise.all(fontUrls.map(async (match) => {
    const original = match[1].replace(/^['"]|['"]$/g, '')
    const absoluteUrl = new URL(original, cssUrl).href
    const dataUrl = await fetchFontDataUrl(absoluteUrl)
    css = css.replace(match[0], `url('${dataUrl}')`)
  }))

  return css
}

// Load and embed share card fonts as data URLs to ensure they work in html-to-image and jsPDF renderings
function getShareCardFontCss(): Promise<string> {
  if (!shareCardFontCssPromise) {
    shareCardFontCssPromise = Promise.all([
      fetchFontDataUrl('/fonts/CooperBlack.ttf'),
      fetchCssFontFaces(ROBOTO_CONDENSED_CSS_URL).catch(() => ''),
    ])
      .then(([cooperBlack, robotoCondensed]) => `
        @font-face {
          font-family: 'Cooper Black';
          src: url('${cooperBlack}') format('truetype');
          font-weight: normal;
          font-style: normal;
        }
        ${robotoCondensed}
      `)
      .catch(() => '')
  }
  return shareCardFontCssPromise
}

export function calculateTitleFontSize(text: string, maxFontSize: number, minFontSize: number): number {
  const reduction = Math.max(0, (text.length - 15) * 1.5)
  return Math.max(minFontSize, Math.min(maxFontSize, maxFontSize - reduction))
}

export interface ShareFormat {
  id: string
  label: string
  width: number
  height: number
}

export const SHARE_FORMATS: Record<string, ShareFormat> = {
  square: { id: 'square', label: 'Square (1080×1080)', width: 1080, height: 1080 },
  story: { id: 'story', label: 'Story (1080×1920)', width: 1080, height: 1920 },
}

export interface ShareVintageColor {
  id: string
  label: string
  value: string
}

export const SHARE_VINTAGE_COLORS: ShareVintageColor[] = [
  { id: 'mustard', label: 'Mustard', value: '#f5c542' },
  { id: 'rust', label: 'Rust', value: '#c8553d' },
  { id: 'red', label: 'Red', value: '#e3360f' },
  { id: 'sage', label: 'Sage', value: '#7a9e7e' },
  { id: 'teal', label: 'Teal', value: '#2d6e7e' },
  { id: 'cream', label: 'Cream', value: '#e8d5a8' },
  { id: 'orange', label: 'Orange', value: '#f5971e' },
]

export interface ShareSticker {
  id: string
  label: string
}

export const SHARE_STICKERS: ShareSticker[] = [
  { id: 'just-announced', label: 'Just Announced!' },
  { id: 'coming-up', label: 'Coming Up!' },
]

export interface ShareStickerPosition {
  id: string
  label: string
}

export const SHARE_STICKER_POSITIONS: ShareStickerPosition[] = [
  { id: 'left-top', label: '↖' },
  { id: 'right-top', label: '↗' },
  { id: 'left-bottom', label: '↙' },
  { id: 'right-bottom', label: '↘' },
]

export function formatGigDateLong(gig: Gig | null | undefined): string {
  if (!gig?.event_date) return ''
  return new Date(gig.event_date).toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export interface GigDateShort {
  weekday: string
  day: string
  month: string
  year: string
}

export function formatGigDateShort(gig: Gig | null | undefined): GigDateShort {
  if (!gig?.event_date) return { weekday: '', day: '', month: '', year: '' }
  const d = new Date(gig.event_date)
  return {
    weekday: d.toLocaleDateString('nl-NL', { weekday: 'long' }),
    day: d.toLocaleDateString('nl-NL', { day: '2-digit' }),
    month: d.toLocaleDateString('nl-NL', { month: 'long' }),
    year: d.toLocaleDateString('nl-NL', { year: 'numeric' }),
  }
}

export function formatGigTimeRange(gig: Gig | null | undefined): string {
  const start = gig?.start_time ? String(gig.start_time).slice(0, 5) : null
  const end = gig?.end_time ? String(gig.end_time).slice(0, 5) : null
  if (!start) return ''
  return end ? `${start} – ${end}` : start
}

export function formatGigDoorsTime(gig: Gig | null | undefined): string {
  if (!gig?.start_time) return ''
  const [h, m] = String(gig.start_time).slice(0, 5).split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const minutes = ((h * 60 + m - 15) % (24 * 60) + 24 * 60) % (24 * 60)
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

export function formatGigVenue(gig: Gig | null | undefined): string {
  // Prefer physical venue; fall back to festival for display when no venue is set
  const v = gig?.venue ?? gig?.festival
  return [venueHeadline(v), venueCity(v)].filter(Boolean).join(', ')
}

export function formatGigVenueName(gig: Gig | null | undefined): string {
  const v = gig?.venue ?? gig?.festival
  return venueHeadline(v)
}

export function formatGigCity(gig: Gig | null | undefined): string {
  // Festival city takes precedence per share-card rules
  if (gig?.festival) return venueCity(gig.festival)
  return venueCity(gig?.venue)
}

export function formatEventName(gig: Gig | null | undefined): string {
  return gig?.event_description || ''
}

interface RenderOptions {
  width: number
  height: number
}

export async function renderNodeToBlob(node: HTMLElement, { width, height }: RenderOptions): Promise<Blob | null> {
  const htmlToImage = await import('html-to-image')

  if (document.fonts && 'ready' in document.fonts) {
    await document.fonts.ready
  }

  return htmlToImage.toBlob(node, {
    width,
    height,
    pixelRatio: 1,
    cacheBust: true,
    backgroundColor: '#000',
    fontEmbedCSS: await getShareCardFontCss(),
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function canCopyImageToClipboard(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.ClipboardItem !== 'undefined' &&
    !!navigator.clipboard?.write
  )
}

export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  if (!canCopyImageToClipboard()) {
    throw new Error('Clipboard image copy not supported in this browser')
  }
  await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })])
}

export function formatGigRowDate(gig: Gig | null | undefined): string {
  if (!gig?.event_date) return ''
  const d = new Date(gig.event_date)
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  const day = String(d.getDate()).padStart(2, '0')
  return `${mon} ${day}`
}

export function buildTourShareFilename(year: number | string, formatId: string): string {
  return `tour-${year}-${formatId}.png`
}

export function buildBannerMosaicFilename(yearLabel: string, formatId: string): string {
  return `banner-mosaic-${yearLabel}-${formatId}.png`
}

export async function renderLayeredPdf(
  node: HTMLElement,
  { width, height }: RenderOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const [{ default: jsPDF }, htmlToImage, fontEmbedCSS] = await Promise.all([
    import('jspdf'),
    import('html-to-image'),
    getShareCardFontCss(),
  ])

  // Collect unique layers in DOM order
  const seen = new Set<string>()
  const layers: Array<{ id: string; el: Element }> = []
  for (const el of node.querySelectorAll('[data-pdf-layer]')) {
    const id = el.getAttribute('data-pdf-layer') as string
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
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const fullPng = await htmlToImage.toPng(node, { width, height, pixelRatio: 1, cacheBust: true, fontEmbedCSS })
    styleEl.remove()

    // Crop to element bounds
    const img = new Image()
    img.src = fullPng
    await img.decode()
    const crop = document.createElement('canvas')
    crop.width = w
    crop.height = h
    crop.getContext('2d')!.drawImage(img, -x, -y)
    const croppedPng = crop.toDataURL('image/png')

    // Place at correct position in PDF
    const pdfX = (x / width) * mmW
    const pdfY = (y / height) * mmH
    pdf.addImage(croppedPng, 'PNG', pdfX, pdfY, (w / width) * mmW, (h / height) * mmH)
  }

  return pdf
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function downloadPdf(pdf: any, filename: string): void {
  pdf.save(filename)
}

export function buildSharePdfFilename(gig: Gig | null | undefined, formatId: string): string {
  const date = gig?.event_date ? String(gig.event_date).slice(0, 10) : 'gig'
  const slug = (gig?.event_description || venueHeadline(gig?.venue) || 'share')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'share'
  return `${date}-${slug}-${formatId}.pdf`
}

export function buildShareFilename(gig: Gig | null | undefined, formatId: string): string {
  const date = gig?.event_date ? String(gig.event_date).slice(0, 10) : 'gig'
  const slug = (gig?.event_description || venueHeadline(gig?.venue) || 'share')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'share'
  return `${date}-${slug}-${formatId}.png`
}
