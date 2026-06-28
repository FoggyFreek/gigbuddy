import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Skeleton from '@mui/material/Skeleton'
import PublicIcon from '@mui/icons-material/Public'
import DashboardCard from './DashboardCard.tsx'
import { useGigMapData } from '../../hooks/useGigMapData.ts'

// Lazy so Leaflet stays in its own chunk, off the dashboard's critical path.
const GigWorldMap = lazy(() => import('../map/GigWorldMap.tsx'))

const MAP_HEIGHT = 180

export default function GigMapTile() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { status, loading, cityCount, markers } = useGigMapData()
  const isEmpty = status === 'ok' && !loading && cityCount === 0
  const showSkeleton = loading && markers.length === 0

  const openMap = () => navigate('/map')

  return (
    <DashboardCard
      title={t($ => $.map.title)}
      icon={PublicIcon}
      count={cityCount}
      viewAllTo="/map"
      viewAllLabel={t($ => $.map.viewMap)}
      status={status}
      isEmpty={isEmpty}
      emptyText={t($ => $.map.empty)}
    >
      {/* Only the preview is clickable — DashboardCard owns its own "View map" link. */}
      <Box
        role="button"
        tabIndex={0}
        aria-label={t($ => $.map.openAria)}
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
