import { createContext, useContext } from 'react'

// Lets a descendant (SplitView, when in master-detail mode) tell AppShell to
// drop the centered content max-width and use the full viewport width instead.
// The value is a stable setter; default is a no-op for components rendered
// outside AppShell (e.g. in tests).
export const ContentWidthContext = createContext<(wide: boolean) => void>(() => {})

export function useSetWideContent(): (wide: boolean) => void {
  return useContext(ContentWidthContext)
}
