import { useMemo } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { createAppTheme } from '../theme.js'
import { useProfile } from './profileContext.js'
import { useThemeMode } from './themeModeContext.js'

export function TenantThemeProvider({ children }) {
  const { accentColor } = useProfile()
  const { mode } = useThemeMode()

  const theme = useMemo(
    () => createAppTheme(mode, accentColor || undefined),
    [mode, accentColor],
  )

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}
