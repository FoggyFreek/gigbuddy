export const TOOLTIP_MARGIN_PX = 2

// Left edge of a chart tooltip card: right of the highlight line by the
// margin, flipped to the left of it when the card would cross the plot's
// right edge.
export function tooltipLeft(
  lineX: number,
  cardWidth: number,
  plotRight: number,
  margin = TOOLTIP_MARGIN_PX,
): number {
  const fitsRight = lineX + margin + cardWidth <= plotRight
  return fitsRight ? lineX + margin : lineX - margin - cardWidth
}
