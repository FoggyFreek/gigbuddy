// Resolves theme palette paths (e.g. "primary.main") to concrete colors and
// derives readable text colors for event chips.

export function resolvePaletteColor(theme, color) {
  if (typeof color !== 'string' || !color.includes('.')) return color
  return color.split('.').reduce((value, key) => value?.[key], theme.palette) || color
}

export function getEventTextColor(theme, backgroundColor) {
  return theme.palette.getContrastText(resolvePaletteColor(theme, backgroundColor))
}
