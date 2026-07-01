import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { createAppTheme } from '../theme.ts'
import type { ThemeVariant } from '../theme.ts'
import { ThemeModeContext } from './themeModeContext.ts'
import type { ThemeMode } from './themeModeContext.ts'

function getInitialMode(): ThemeMode {
  const stored = localStorage.getItem('colorMode')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialVariant(): ThemeVariant {
  const stored = localStorage.getItem('themeVariant')
  if (stored === 'default' || stored === 'warm' || stored === 'slate') return stored
  return 'default'
}

interface ThemeContextProviderProps {
  children: ReactNode
}

export function ThemeContextProvider({ children }: Readonly<ThemeContextProviderProps>) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode)
  const [variant, setVariantState] = useState<ThemeVariant>(getInitialVariant)

  useEffect(() => {
    localStorage.setItem('colorMode', mode)
  }, [mode])

  const setVariant = useCallback((v: ThemeVariant) => {
    setVariantState(v)
    localStorage.setItem('themeVariant', v)
  }, [])

  const toggleTheme = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), [])
  const theme = useMemo(() => createAppTheme(mode, null, variant), [mode, variant])
  const modeContextValue = useMemo(
    () => ({ mode, toggleTheme, variant, setVariant }),
    [mode, toggleTheme, variant, setVariant],
  )

  return (
    <ThemeModeContext.Provider value={modeContextValue}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  )
}
