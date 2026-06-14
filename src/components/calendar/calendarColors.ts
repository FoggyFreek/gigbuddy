// Resolves theme palette paths (e.g. "primary.main") to concrete colors and
// derives readable text colors for event chips.
import type { Theme } from '@mui/material/styles'

export function resolvePaletteColor(theme: Theme, color: string): string {
  if (!color.includes('.')) return color
  // Walk the nested palette path; fall back to the original string if any
  // segment doesn't exist (e.g. a plain hex color passed in).
  const resolved = color.split('.').reduce<unknown>((value, key) => {
    if (value !== null && typeof value === 'object') {
      return (value as Record<string, unknown>)[key]
    }
    return undefined
  }, theme.palette)
  return typeof resolved === 'string' ? resolved : color
}

export function getEventTextColor(theme: Theme, backgroundColor: string): string {
  return theme.palette.getContrastText(resolvePaletteColor(theme, backgroundColor))
}
