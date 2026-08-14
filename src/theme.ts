import { createTheme } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

export type ThemeVariant = 'default' | 'warm' | 'slate'

/**
 * Categorical chart slots. The *order* is the colour-blind-safety mechanism:
 * neighbouring slots are the pairs a stacked bar or a pie puts side by side,
 * and this order clears the adjacent-pair gates (CVD ΔE ≥ 8, normal-vision
 * ΔE ≥ 15) against the card surfaces of both modes. Assign a slot by category
 * *identity*, never by rank, so a quiet day can't repaint the series. Several
 * slots sit under 3:1 against their surface, so any chart using them ships
 * readable relief: a legend, value labels, or a table beside it.
 */
export interface ChartPalette {
  c1: string; c2: string; c3: string; c4: string
  c5: string; c6: string; c7: string; c8: string
}

const CHART_LIGHT: ChartPalette = {
  c1: '#2a78d6', c2: '#eb6834', c3: '#1baf7a', c4: '#eda100',
  c5: '#e87ba4', c6: '#008300', c7: '#4a3aa7', c8: '#e34948',
}

const CHART_DARK: ChartPalette = {
  c1: '#3987e5', c2: '#d95926', c3: '#199e70', c4: '#c98500',
  c5: '#d55181', c6: '#008300', c7: '#9085e9', c8: '#e66767',
}

declare module '@mui/material/styles' {
  interface Palette {
    chart: ChartPalette
  }
  interface PaletteOptions {
    chart?: ChartPalette
  }
}

interface VariantTokenSet {
  bg: string
  paper: string
  secondary: string
  scrollThumb: string
  scrollThumbHover: string
  fontFamily: string
}

export const VARIANT_TOKENS: Record<ThemeVariant, { light: VariantTokenSet; dark: VariantTokenSet }> = {
  default: {
    light:  { bg: '#FFFBFE', paper: '#FFFFFF', secondary: '#625B71', scrollThumb: '#C4C0CF', scrollThumbHover: '#9E99A9', fontFamily: 'Roboto, sans-serif' },
    dark:   { bg: '#1C1B1F', paper: '#2B2930', secondary: '#CCC2DC', scrollThumb: '#4A4458', scrollThumbHover: '#625B71', fontFamily: 'Roboto, sans-serif' },
  },
  warm: {
    light:  { bg: '#FDF6EF', paper: '#FFF9F4', secondary: '#8B5A2B', scrollThumb: '#D4B49A', scrollThumbHover: '#B8906A', fontFamily: 'Lato, sans-serif' },
    dark:   { bg: '#1C1510', paper: '#2A2016', secondary: '#D4A574', scrollThumb: '#4D3820', scrollThumbHover: '#6B5030', fontFamily: 'Lato, sans-serif' },
  },
  slate: {
    light:  { bg: '#F8FAFC', paper: '#FFFFFF', secondary: '#475569', scrollThumb: '#CBD5E1', scrollThumbHover: '#94A3B8', fontFamily: 'Montserrat, sans-serif' },
    dark:   { bg: '#0F172A', paper: '#1E293B', secondary: '#94A3B8', scrollThumb: '#334155', scrollThumbHover: '#475569', fontFamily: 'Montserrat, sans-serif' },
  },
}

export function createAppTheme(mode: 'light' | 'dark', primaryColor?: string | null, variant: ThemeVariant = 'default'): Theme {
  const isDark = mode === 'dark'
  const tokens = VARIANT_TOKENS[variant][isDark ? 'dark' : 'light']
  const primary = primaryColor || (isDark ? '#D0BCFF' : '#6750A4')
  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      secondary: { main: tokens.secondary },
      success: { main: isDark ? '#6FC97D' : '#386A20' },
      background: { default: tokens.bg, paper: tokens.paper },
      chart: isDark ? CHART_DARK : CHART_LIGHT,
    },
    typography: {
      fontFamily: tokens.fontFamily,
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '*': {
            scrollbarWidth: 'thin',
            scrollbarColor: `${tokens.scrollThumb} ${tokens.bg}`,
          },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-track': { background: tokens.bg },
          '*::-webkit-scrollbar-thumb': {
            background: tokens.scrollThumb,
            borderRadius: 4,
          },
          '*::-webkit-scrollbar-thumb:hover': {
            background: tokens.scrollThumbHover,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
        },
      },
    },
  })
}

export default createAppTheme('light')
