import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import AvailabilitySection from '../components/AvailabilitySection.tsx'
import SplitView from '../components/SplitView.tsx'

export default function AvailabilityPage() {
  const { t } = useTranslation('availability')
  const [eventReloadKey, setEventReloadKey] = useState(0)
  const reloadDeletedEvent = useCallback(() => {
    setEventReloadKey((key) => key + 1)
  }, [])

  return (
    <SplitView
      basePath="/availability"
      outletContext={{
        onGigDelete: reloadDeletedEvent,
        onRehearsalDelete: reloadDeletedEvent,
        onBandEventDelete: reloadDeletedEvent,
      }}
    >
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
          {t($ => $.title)}
        </Typography>
        <AvailabilitySection basePath="/availability" eventReloadKey={eventReloadKey} />
      </Box>
    </SplitView>
  )
}
