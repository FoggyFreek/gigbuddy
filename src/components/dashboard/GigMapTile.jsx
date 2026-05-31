import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Skeleton from '@mui/material/Skeleton'
import PublicIcon from '@mui/icons-material/Public'
import DashboardCard from './DashboardCard.jsx'
import { useGigMapData } from '../../hooks/useGigMapData.js'

// Lazy so Leaflet stays in its own chunk, off the dashboard's critical path.
const GigWorldMap = lazy(() => import('../map/GigWorldMap.jsx'))

const MAP_HEIGHT = 180

export default function GigMapTile() {
  const navigate = useNavigate()
  const { status, loading, cityCount, markers } = useGigMapData()
  const isEmpty = status === 'ok' && !loading && cityCount === 0
  const showSkeleton = loading && markers.length === 0

  const openMap = () => navigate('/map')

  return (
    <DashboardCard
      title="Played here"
      icon={PublicIcon}
      count={cityCount}
      viewAllTo="/map"
      viewAllLabel="View map"
      status={status}
      isEmpty={isEmpty}
      emptyText="No past gigs yet"
    >
      {/* Only the preview is clickable — DashboardCard owns its own "View map" link. */}
      <Box
        role="button"
        tabIndex={0}
        aria-label="Open the gig world map"
        onClick={openMap}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openMap()
          }
        }}
        sx={{ cursor: 'pointer' }}
      >
        {showSkeleton ? (
          <Skeleton variant="rounded" height={MAP_HEIGHT} />
        ) : (
          <Suspense fallback={<Skeleton variant="rounded" height={MAP_HEIGHT} />}>
            <GigWorldMap markers={markers} interactive={false} height={MAP_HEIGHT} />
          </Suspense>
        )}
      </Box>
    </DashboardCard>
  )
}
