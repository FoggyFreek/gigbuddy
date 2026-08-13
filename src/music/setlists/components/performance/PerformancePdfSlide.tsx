import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Page, pdfjs } from 'react-pdf'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const loadingSpinner = (
  <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
    <CircularProgress size={28} />
  </Box>
)

interface Size { width: number; height: number }

// The page's own dimensions, as react-pdf reports them. `originalWidth`/`Height`
// are the unscaled ones; fall back to width/height for safety.
function nextIntrinsic(previous: Size | null, loaded: unknown): Size | null {
  const page = loaded as Partial<Record<'originalWidth' | 'originalHeight' | 'width' | 'height', number>>
  const width = page?.originalWidth ?? page?.width
  const height = page?.originalHeight ?? page?.height
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return previous
  // Same page re-reporting itself must not churn state and re-render forever.
  if (previous && previous.width === width && previous.height === height) return previous
  return { width, height }
}

// Largest rendering of `page` that fits inside `box` on both axes.
function fitToBox(page: Size | null, box: Size): Size | null {
  if (!page || box.width <= 0 || box.height <= 0) return null
  const scale = Math.min(box.width / page.width, box.height / page.height)
  return { width: page.width * scale, height: page.height * scale }
}

interface PerformancePdfSlideProps {
  objectKey: string
  /** Which page to show, 0-based (the PDF's own page numbering starts at 1). */
  page: number
  /** Reports the document's page count once it loads. */
  onPageCount: (count: number) => void
}

// One PDF sheet filling the stage screen. Sized to fit the viewport *height*
// rather than its width — on stage the whole page has to be visible at once, so
// there is nothing to scroll past.
export default function PerformancePdfSlide({
  objectKey,
  page,
  onPageCount,
}: Readonly<PerformancePdfSlideProps>) {
  const { t } = useTranslation('setlists')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [intrinsic, setIntrinsic] = useState<{ width: number; height: number } | null>(null)

  // Only store a genuinely new size; a fresh object per observer tick would
  // re-render and re-rasterize the page for nothing.
  const readBox = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const next = { width: el.clientWidth, height: el.clientHeight }
    setBox((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
  }, [])

  useEffect(() => {
    readBox()
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(readBox)
    observer.observe(el)
    return () => observer.disconnect()
  }, [readBox])

  // Fit the whole page inside the viewport on both axes. Sizing by height alone
  // clips a landscape or otherwise wide page against the container's hidden
  // overflow, which on stage means silently losing part of the music.
  const fitted = fitToBox(intrinsic, box)

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Document
        // `?inline=1` makes the file route serve Content-Disposition: inline and
        // relax frame-ancestors, which pdf.js needs to render it in place.
        file={`/api/files/${objectKey}?inline=1`}
        loading={loadingSpinner}
        error={<Alert severity="error">{t($ => $.perform.pdfError)}</Alert>}
        onLoadSuccess={({ numPages }) => onPageCount(numPages)}
      >
        <Page
          pageNumber={page + 1}
          // Width wins when the page's own size is known, because it encodes the
          // both-axes fit; height alone is the fallback until then.
          width={fitted?.width}
          height={fitted ? undefined : (box.height || undefined)}
          onLoadSuccess={(loaded) => setIntrinsic((prev) => nextIntrinsic(prev, loaded))}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={loadingSpinner}
        />
      </Document>
    </Box>
  )
}
