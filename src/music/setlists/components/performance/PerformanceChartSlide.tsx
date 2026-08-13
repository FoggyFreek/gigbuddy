import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import ChordProView from '../../../songs/components/chordpro/ChordProView.tsx'

// Fixed, deliberately large: on stage the chart is read at arm's length or
// further, and a size that shifts per song is harder to read than one that
// doesn't. Anything that doesn't fit is paged through instead of shrunk.
const STAGE_FONT_SIZE = 26

// Stage overrides on top of ChordProView's own styles. Chords get room to
// breathe — wider gaps between cells, clear separation from the lyric under
// them, and slightly larger than the lyrics so the eye finds them first.
const stageChartSx = {
  '& .chord-sheet': { lineHeight: 1.5 },
  '& .paragraph': { mb: 3 },
  '& .chord, & .annotation': { pr: '22px', pb: '6px' },
  '& .chord': { fontSize: '1.1em' },
  '& .title': { fontSize: '1.6em' },
  '& .label': { fontSize: '0.6em' },
} as const

interface PerformanceChartSlideProps {
  source: string
  /** Which screenful to show, 0-based. */
  page: number
  /** Reports how many screenfuls this chart needs. */
  onPageCount: (count: number) => void
}

// One ChordPro chart on the stage screen, rendered at a fixed large size. A
// chart taller than the viewport is split into screenfuls that the page-turner
// steps through before moving on to the next song.
//
// ChordProView is reused as-is — it styles from palette tokens, so the dark
// theme the page wraps it in recolours it for stage use.
export default function PerformanceChartSlide({
  source,
  page,
  onPageCount,
}: Readonly<PerformanceChartSlideProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [pages, setPages] = useState(1)

  // Only store a genuinely new size. A fresh object on every observer tick would
  // re-render, and re-rendering ChordProView re-sets its innerHTML — replacing
  // the whole chart in the DOM for no reason.
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

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || box.height <= 0) return
    const count = Math.max(1, Math.ceil(content.scrollHeight / box.height))
    setPages((prev) => (prev === count ? prev : count))
    onPageCount(count)
  }, [source, box.height, box.width, onPageCount])

  const centred = pages <= 1

  return (
    // The container carries no padding of its own: an absolutely positioned
    // child ignores it, which would put the measured height and the visible
    // height out of step. The content box pads itself instead, so its
    // scrollHeight is exactly what has to fit into clientHeight.
    <Box
      ref={containerRef}
      sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <Box
        ref={contentRef}
        style={{
          fontSize: `${STAGE_FONT_SIZE}px`,
          // A chart that fits on one screen is centred vertically; one that
          // paginates is pinned to the top, because the page offset and a
          // centring translate can't both own the transform.
          top: centred ? '50%' : 0,
          transform: centred ? 'translateY(-50%)' : `translateY(${-page * box.height}px)`,
        }}
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          boxSizing: 'border-box',
          px: 3,
          py: 2,
          // The chart block is only as wide as its longest line, so centring the
          // flex item centres the chart on screen.
          display: 'flex',
          justifyContent: 'center',
          transition: 'transform 120ms ease-out',
          ...stageChartSx,
        }}
      >
        <Box sx={{ maxWidth: '100%' }}>
          {/* Diagrams open: nobody is going to tap a disclosure mid-song. */}
          <ChordProView source={source} diagramsOpen />
        </Box>
      </Box>
    </Box>
  )
}
