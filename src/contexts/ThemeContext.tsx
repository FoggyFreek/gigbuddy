import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { createAppTheme } from '../theme.ts'
import { ThemeModeContext } from './themeModeContext.ts'
import type { ThemeMode } from './themeModeContext.ts'

function getInitialMode(): ThemeMode {
  const stored = localStorage.getItem('colorMode')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface ThemeContextProviderProps {
  children: ReactNode
}

export function ThemeContextProvider({ children }: ThemeContextProviderProps) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode)

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
