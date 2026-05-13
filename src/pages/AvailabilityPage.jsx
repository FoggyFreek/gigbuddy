import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import AvailabilitySection from '../components/AvailabilitySection.jsx'
import SplitView from '../components/SplitView.jsx'

export default function AvailabilityPage() {
  return (
    <SplitView basePath="/availability">
      <Box>
        <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
          Calendar
        </Typography>
        <AvailabilitySection basePath="/availability" />
      </Box>
    </SplitView>
  )
}
