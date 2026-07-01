import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { createAppTheme } from '../theme.ts'
import { useProfile } from './profileContext.ts'
import { useThemeMode } from './themeModeContext.ts'

interface TenantThemeProviderProps {
  children: ReactNode
}

export function TenantThemeProvider({ children }: Readonly<TenantThemeProviderProps>) {
  const { accentColor } = useProfile()
  const { mode, variant } = useThemeMode()

  const theme = useMemo(
    () => createAppTheme(mode, accentColor || undefined, variant),
    [mode, accentColor, variant],
  )

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}
