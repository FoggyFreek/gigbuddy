import { createContext, useContext } from 'react'

export type ThemeMode = 'light' | 'dark'

export interface ThemeModeContextValue {
  mode: ThemeMode
  toggleTheme: () => void
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: 'light',
  toggleTheme: () => {},
})

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext)
}
