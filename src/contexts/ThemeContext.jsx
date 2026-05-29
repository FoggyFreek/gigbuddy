import { useCallback, useEffect, useMemo, useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { createAppTheme } from '../theme.js'
import { ThemeModeContext } from './themeModeContext.js'

function getInitialMode() {
  const stored = localStorage.getItem('colorMode')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeContextProvider({ children }) {
  const [mode, setMode] = useState(getInitialMode)

  useEffect(() => {
    localStorage.setItem('colorMode', mode)
  }, [mode])

  const toggleTheme = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), [])
  const theme = useMemo(() => createAppTheme(mode), [mode])
  const modeContextValue = useMemo(() => ({ mode, toggleTheme }), [mode, toggleTheme])

  return (
    <ThemeModeContext.Provider value={modeContextValue}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  )
}
