import { computePurchaseTotals } from '../../utils/purchaseTotals.ts'
import Box from '@mui/material/Box'
import { useTranslation } from 'react-i18next'
import Typography from '@mui/material/Typography'
import { formatEur } from '../../utils/purchaseTotals.ts'

interface PurchaseTotalsPanelProps {
  totals: ReturnType<typeof computePurchaseTotals>
  currency?: string
}

export default function PurchaseTotalsPanel({ totals, currency = 'EUR' }: PurchaseTotalsPanelProps) {
  const { t } = useTranslation('purchases')
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto',
        gap: 2,
        alignItems: 'baseline',
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t($ => $.totals.heading, { currency })}
      </Typography>
      <Box sx={{ textAlign: 'right', minWidth: 100 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t($ => $.labels.exclVat)}</Typography>
        <Typography variant="body1">{formatEur(totals.subtotalCents)}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', minWidth: 100 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t($ => $.labels.vatAmount)}</Typography>
        <Typography variant="body1">{formatEur(totals.taxCents)}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', minWidth: 100 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t($ => $.labels.inclVat)}</Typography>
        <Typography variant="body1" sx={{ fontWeight: 700 }}>{formatEur(totals.totalCents)}</Typography>
      </Box>
    </Box>
  )
}
