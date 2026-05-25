import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

export default function SummaryRow({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  )
}

SummaryRow.propTypes = {
  label: PropTypes.node,
  value: PropTypes.node,
}
