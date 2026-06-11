export const TOOLTIP_MARGIN_PX = 2

// Left edge of a chart tooltip card: right of the highlight line by the
// margin, flipped to the left of it when the card would cross the plot's
// right edge.
export function tooltipLeft(lineX, cardWidth, plotRight, margin = TOOLTIP_MARGIN_PX) {
  const fitsRight = lineX + margin + cardWidth <= plotRight
  return fitsRight ? lineX + margin : lineX - margin - cardWidth
}
