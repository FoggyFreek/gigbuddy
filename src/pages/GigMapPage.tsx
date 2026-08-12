import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import GigWorldMap from '../components/map/GigWorldMap.tsx'
import { useGigMapData } from '../hooks/useGigMapData.ts'

export default function GigMapPage() {
  const { t } = useTranslation('dashboard')
  const { status, loading, cityCount, gigCount, markers } = useGigMapData()

  let mapContent
  if (status === 'error') {
    mapContent = <Alert severity="error">{t($ => $.map.loadError)}</Alert>
  } else if (loading && markers.length === 0) {
    mapContent = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  } else {
    mapContent = <GigWorldMap markers={markers} interactive height="100%" />
  }

  return (
    // Leaflet needs a concrete height; AppShell adds a toolbar + p:3 padding, so
    // size the column off the viewport and let the map fill the remaining space.
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 360 }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.map.title)}
      </Typography>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        {t($ => $.map.summary, {
          count: cityCount,
          gigCount: t($ => $.map.gigCount, { count: gigCount }),
        })}
      </Typography>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {mapContent}
      </Box>
    </Box>
  )
}
