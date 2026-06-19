import { createContext, useContext } from 'react'
import type { ThemeVariant } from '../theme.ts'

export type ThemeMode = 'light' | 'dark'

export interface ThemeModeContextValue {
  mode: ThemeMode
  toggleTheme: () => void
  variant: ThemeVariant
  setVariant: (v: ThemeVariant) => void
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: 'light',
  toggleTheme: () => {},
  variant: 'default',
  setVariant: () => {},
})

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext)
}
