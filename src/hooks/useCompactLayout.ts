import { createContext, useContext } from 'react'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

export const CompactLayoutContext = createContext<boolean>(false)

export function useCompactLayout(): boolean {
  const theme = useTheme()
  const belowSm = useMediaQuery(theme.breakpoints.down('sm'))
  const forced = useContext(CompactLayoutContext)
  return belowSm || forced
}

// True when the compact layout comes from a SplitView list pane instead of a
// narrow viewport — the pane owns only part of the screen, so anything that
// would otherwise be pinned to the viewport must stay inside it.
export function useSplitPaneLayout(): boolean {
  return useContext(CompactLayoutContext)
}
