import { createTheme } from '@mui/material/styles'

export function createAppTheme(mode) {
  const isDark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: { main: isDark ? '#D0BCFF' : '#6750A4' },
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
