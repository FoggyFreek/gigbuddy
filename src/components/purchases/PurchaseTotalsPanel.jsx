import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { formatEur } from '../../utils/purchaseTotals.js'

export default function PurchaseTotalsPanel({ totals, currency = 'EUR' }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto',
        gap: 2,
        alignItems: 'baseline',
      }}
    >
      <Typography variant="subtitle1" fontWeight={600}>
        Total ({currency})
      </Typography>
      <Box sx={{ textAlign: 'right', minWidth: 100 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Excl. VAT</Typography>
        <Typography variant="body1">{formatEur(totals.subtotalCents)}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', minWidth: 100 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>VAT - amount</Typography>
        <Typography variant="body1">{formatEur(totals.taxCents)}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', minWidth: 100 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Incl. VAT</Typography>
        <Typography variant="body1" fontWeight={700}>{formatEur(totals.totalCents)}</Typography>
      </Box>
    </Box>
  )
}

PurchaseTotalsPanel.propTypes = {
  totals: PropTypes.object.isRequired,
  currency: PropTypes.string,
}
