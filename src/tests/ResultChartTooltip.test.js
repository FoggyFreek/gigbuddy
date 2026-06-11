import { describe, expect, it } from 'vitest'
import { tooltipLeft, TOOLTIP_MARGIN_PX } from '../utils/chartTooltipPosition.js'

describe('tooltipLeft', () => {
  it('anchors the card 2px right of the line when it fits', () => {
    // Line at 100, card 200 wide, plot ends at 400: 100 + 2 + 200 <= 400.
    expect(tooltipLeft(100, 200, 400)).toBe(100 + TOOLTIP_MARGIN_PX)
  })

  it('flips to 2px left of the line when the right side is too tight', () => {
    // 300 + 2 + 200 > 400 → card sits left of the line.
    expect(tooltipLeft(300, 200, 400)).toBe(300 - TOOLTIP_MARGIN_PX - 200)
  })

  it('treats an exact fit as fitting right', () => {
    expect(tooltipLeft(198, 200, 400)).toBe(198 + TOOLTIP_MARGIN_PX)
  })
})
