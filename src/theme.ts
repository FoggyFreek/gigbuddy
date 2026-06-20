import { createTheme } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

export type ThemeVariant = 'default' | 'warm' | 'slate'

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
    light:  { bg: '#FDF6EF', paper: '#FFF9F4', secondary: '#8B5A2B', scrollThumb: '#D4B49A', scrollThumbHover: '#B8906A', fontFamily: '"Segoe UI", sans-serif' },
    dark:   { bg: '#1C1510', paper: '#2A2016', secondary: '#D4A574', scrollThumb: '#4D3820', scrollThumbHover: '#6B5030', fontFamily: '"Segoe UI", sans-serif' },
  },
  slate: {
    light:  { bg: '#F8FAFC', paper: '#FFFFFF', secondary: '#475569', scrollThumb: '#CBD5E1', scrollThumbHover: '#94A3B8', fontFamily: 'Lato, sans-serif' },
    dark:   { bg: '#0F172A', paper: '#1E293B', secondary: '#94A3B8', scrollThumb: '#334155', scrollThumbHover: '#475569', fontFamily: 'Lato, sans-serif' },
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
