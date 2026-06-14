import { useCallback, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useAxesTooltip } from '@mui/x-charts/ChartsTooltip'
import { useDrawingArea, useXScale } from '@mui/x-charts/hooks'
import { tooltipLeft } from '../../utils/chartTooltipPosition.ts'

// Replacement for ChartsTooltip in the result chart: anchored to the axis
// highlight line of the hovered month instead of following the pointer.
// Rendered inside the chart SVG, so the HTML card lives in a <foreignObject>.
export default function ResultChartTooltip() {
  const tooltipData = useAxesTooltip()
  const xScale = useXScale()
  const area = useDrawingArea()
  const observerRef = useRef<ResizeObserver | null>(null)
  const [cardWidth, setCardWidth] = useState(0)

  // Watch the rendered card's size so the flip decision uses its real width
  // (it changes with the hovered month's values).
  const cardRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node || typeof ResizeObserver === 'undefined') return
    observerRef.current = new ResizeObserver((entries) => {
      setCardWidth(Math.ceil(entries[0].target.clientWidth))
    })
    observerRef.current.observe(node)
  }, [])

  const axis = tooltipData?.[0]
  if (!axis) return null

  const lineX = (xScale(axis.axisValue as never) ?? 0) + ((xScale as { bandwidth?: () => number }).bandwidth?.() ?? 0) / 2
  const left = tooltipLeft(lineX, cardWidth, area.left + area.width)

  return (
    <foreignObject
      x={left}
      y={area.top + 8}
      width={cardWidth || 1}
      height={area.height}
      // Hidden until measured so the first hover doesn't flash at the wrong spot.
      visibility={cardWidth ? 'visible' : 'hidden'}
      style={{ overflow: 'visible', pointerEvents: 'none' }}
    >
      <Box
        ref={cardRef}
        sx={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 0,
          boxShadow: 3,
          px: 1.5,
          py: 1,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 600 }} component="div">
          {axis.axisFormattedValue}
        </Typography>
        {axis.seriesItems.map((item) => (
          <Box key={item.seriesId} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: item.color, flexShrink: 0 }} />
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pr: 2 }}>
              {item.formattedLabel}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {item.formattedValue}
            </Typography>
          </Box>
        ))}
      </Box>
    </foreignObject>
  )
}
