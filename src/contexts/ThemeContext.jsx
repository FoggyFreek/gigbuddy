import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { createAppTheme } from '../theme.js'

const ThemeContext = createContext({ mode: 'light', toggleTheme: () => {} })

export function useThemeMode() {
  return useContext(ThemeContext)
}

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

  const toggleTheme = () => setMode((m) => (m === 'light' ? 'dark' : 'light'))

  const theme = useMemo(() => createAppTheme(mode), [mode])

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeContext.Provider>
  )
}
