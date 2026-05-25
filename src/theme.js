import { createTheme } from '@mui/material/styles'

export function createAppTheme(mode, primaryColor) {
  const isDark = mode === 'dark'
  const primary = primaryColor || (isDark ? '#D0BCFF' : '#6750A4')
  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      secondary: { main: isDark ? '#CCC2DC' : '#625B71' },
      success: { main: isDark ? '#6FC97D' : '#386A20' },
      background: isDark
        ? { default: '#1C1B1F', paper: '#2B2930' }
        : { default: '#FFFBFE', paper: '#FFFFFF' },
    },
    typography: {
      fontFamily: 'Roboto, sans-serif',
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '*': {
            scrollbarWidth: 'thin',
            scrollbarColor: isDark
              ? '#4A4458 #2B2930'
              : '#C4C0CF #FFFBFE',
          },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-track': {
            background: isDark ? '#2B2930' : '#FFFBFE',
          },
          '*::-webkit-scrollbar-thumb': {
            background: isDark ? '#4A4458' : '#C4C0CF',
            borderRadius: 4,
          },
          '*::-webkit-scrollbar-thumb:hover': {
            background: isDark ? '#625B71' : '#9E99A9',
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
