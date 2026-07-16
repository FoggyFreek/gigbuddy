import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { Outlet, useNavigate, useOutlet } from 'react-router-dom'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import { useSetWideContent } from '../contexts/contentWidthContext.ts'

interface SplitViewProps {
  basePath: string
  children: ReactNode
  outletContext?: Record<string, unknown>
}

export default function SplitView({ basePath, children, outletContext }: Readonly<SplitViewProps>) {
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('sm'))
  const navigate = useNavigate()
  const hasDetail = useOutlet() != null
  const setWideContent = useSetWideContent()

  const normalizedBase = basePath.replace(/\/$/, '')
  const handleClose = useCallback(() => navigate(normalizedBase), [navigate, normalizedBase])

  const splitDesktop = hasDetail && isDesktop
  const hideList = hasDetail && !isDesktop

  // Stable reference: react-router re-renders every useOutletContext()
  // consumer whenever this object's identity changes, so an unrelated
  // GigsPage/SplitView re-render (e.g. list search, tab switch) must not
  // recreate it unless something the detail pane actually reads has changed.
  const outletContextValue = useMemo(
    () => ({ insideSplitView: isDesktop, onClose: handleClose, ...outletContext }),
    [isDesktop, handleClose, outletContext],
  )

  // While the master-detail layout is active, let the page use full width;
  // restore the capped/centered default when it closes or this view unmounts.
  useEffect(() => {
    setWideContent(splitDesktop)
    return () => setWideContent(false)
  }, [splitDesktop, setWideContent])

  return (
    <Box
      sx={{
        display: 'flex',
        gap: splitDesktop ? 2 : 0,
        alignItems: splitDesktop ? 'stretch' : 'flex-start',
        width: '100%',
        ...(splitDesktop && { height: 'calc(100vh - 112px)' }),
      }}
    >
      <Box
        sx={{
          flex: splitDesktop ? '0 0 30%' : '1 1 100%',
          minWidth: 0,
          overflow: splitDesktop ? 'hidden auto' : 'visible',
          display: hideList ? 'none' : 'block',
        }}
      >
        <CompactLayoutContext.Provider value={splitDesktop}>
          {children}
        </CompactLayoutContext.Provider>
      </Box>
      {splitDesktop && (
        <Divider orientation="vertical" flexItem sx={{ alignSelf: 'stretch' }} />
      )}
      {hasDetail && (
        <Box
          sx={{
            flex: isDesktop ? '1 1 70%' : '1 1 100%',
            minWidth: 0,
            ...(splitDesktop && { overflow: 'hidden auto' }),
          }}
        >
          <Outlet context={outletContextValue} />
        </Box>
      )}
    </Box>
  )
}
