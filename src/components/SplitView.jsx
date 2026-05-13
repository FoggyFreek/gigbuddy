import { Outlet, useNavigate, useOutlet } from 'react-router-dom'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { CompactLayoutContext } from '../hooks/useCompactLayout.js'

export default function SplitView({ basePath, children, outletContext }) {
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('sm'))
  const navigate = useNavigate()
  const hasDetail = useOutlet() != null

  const normalizedBase = basePath.replace(/\/$/, '')
  const handleClose = () => navigate(normalizedBase)

  const splitDesktop = hasDetail && isDesktop
  const hideList = hasDetail && !isDesktop

  return (
    <Box
      sx={{
        display: 'flex',
        gap: splitDesktop ? 2 : 0,
        alignItems: 'flex-start',
        width: '100%',
      }}
    >
      <Box
        sx={{
          flex: splitDesktop ? '0 0 30%' : '1 1 100%',
          minWidth: 0,
          overflow: splitDesktop ? 'hidden' : 'visible',
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
        <Box sx={{ flex: isDesktop ? '1 1 70%' : '1 1 100%', minWidth: 0 }}>
          <Outlet context={{ insideSplitView: isDesktop, onClose: handleClose, ...outletContext }} />
        </Box>
      )}
    </Box>
  )
}
