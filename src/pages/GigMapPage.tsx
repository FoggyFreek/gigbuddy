import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import GigWorldMap from '../components/map/GigWorldMap.tsx'
import { useGigMapData } from '../hooks/useGigMapData.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export default function GigMapPage() {
  const { status, loading, cityCount, gigCount, markers } = useGigMapData()

  let mapContent
  if (status === 'error') {
    mapContent = <Alert severity="error">Couldn&apos;t load the gig map.</Alert>
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
        Played here
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {plural(gigCount, 'gig', 'gigs')} across {plural(cityCount, 'city', 'cities')}
      </Typography>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {mapContent}
      </Box>
    </Box>
  )
}
