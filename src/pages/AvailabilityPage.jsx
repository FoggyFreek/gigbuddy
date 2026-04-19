import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import AvailabilitySection from '../components/AvailabilitySection.jsx'

export default function AvailabilityPage() {
  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Availability
      </Typography>
      <AvailabilitySection />
    </Box>
  )
}
