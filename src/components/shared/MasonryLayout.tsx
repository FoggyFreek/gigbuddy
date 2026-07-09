import { Children, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'

interface MasonryItemProps {
  gapPx: number
  children: ReactNode
}

/**
 * Grid item that spans as many 1px implicit rows as its content is tall (plus
 * the gap), so the parent grid can pack items masonry-style. Re-measured via
 * ResizeObserver when content changes (images loading, data arriving).
 */
function MasonryItem({ gapPx, children }: Readonly<MasonryItemProps>) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      el.style.gridRowEnd = `span ${Math.max(1, Math.ceil(el.offsetHeight) + gapPx)}`
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    // Defer the re-measure out of the observer callback: writing gridRowEnd can
    // reshuffle grid auto-placement and resize siblings, so a synchronous write
    // feeds back into the observer and trips "ResizeObserver loop completed with
    // undelivered notifications". A rAF breaks that same-frame chain.
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [gapPx])

  return <div ref={ref}>{children}</div>
}

interface MasonryLayoutProps {
  /** Minimum column width in px; the column count adapts to the container. */
  columnWidth: number
  /** Gap between cards, in theme spacing units. */
  spacing: number
  children: ReactNode
}

/**
 * Masonry layout that keeps DOM (reading/tab) order flowing left-to-right
 * across columns, unlike CSS multi-column which flows down one column before
 * starting the next. Same measured-placement idea as MUI Lab's <Masonry>, but
 * implemented with the CSS-grid row-span technique: the grid auto-places each
 * item in DOM order into the first column with room (≈ the shortest column),
 * and the item's measured height decides how many 1px rows it spans.
 *
 * Collapses to a single column on narrow screens via auto-fill, so callers
 * don't need a separate compact branch — at most a smaller `spacing`.
 */
export default function MasonryLayout({ columnWidth, spacing, children }: Readonly<MasonryLayoutProps>) {
  const theme = useTheme()
  const gapPx = parseFloat(theme.spacing(spacing))

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${columnWidth}px, 100%), 1fr))`,
        columnGap: `${gapPx}px`,
        gridAutoRows: '1px',
        // Items must keep their natural height (measurement source); stretch
        // would size them to the span and feed back into the measurement.
        alignItems: 'start',
      }}
    >
      {Children.map(children, (child) => (
        child == null || typeof child === 'boolean'
          ? child
          : <MasonryItem gapPx={gapPx}>{child}</MasonryItem>
      ))}
    </Box>
  )
}
