import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import GigWorldMap from '../components/map/GigWorldMap.jsx'
import { useGigMapData } from '../hooks/useGigMapData.js'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export default function GigMapPage() {
  const { status, loading, cityCount, gigCount, markers } = useGigMapData()

  return (
    // Leaflet needs a concrete height; AppShell adds a toolbar + p:3 padding, so
    // size the column off the viewport and let the map fill the remaining space.
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 360 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 0.5 }}>
        Played here
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {plural(gigCount, 'gig', 'gigs')} across {plural(cityCount, 'city', 'cities')}
      </Typography>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {status === 'error' ? (
          <Alert severity="error">Couldn&apos;t load the gig map.</Alert>
        ) : loading && markers.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <GigWorldMap markers={markers} interactive height="100%" />
        )}
      </Box>
    </Box>
  )
}
