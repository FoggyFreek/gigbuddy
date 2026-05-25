import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import AvailabilitySection from '../components/AvailabilitySection.jsx'
import SplitView from '../components/SplitView.jsx'

export default function AvailabilityPage() {
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
        <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
          Calendar
        </Typography>
        <AvailabilitySection basePath="/availability" eventReloadKey={eventReloadKey} />
      </Box>
    </SplitView>
  )
}
