import { createContext, useContext } from 'react'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

export const CompactLayoutContext = createContext(false)

export function useCompactLayout() {
  const theme = useTheme()
  const belowSm = useMediaQuery(theme.breakpoints.down('sm'))
  const forced = useContext(CompactLayoutContext)
  return belowSm || forced
}
