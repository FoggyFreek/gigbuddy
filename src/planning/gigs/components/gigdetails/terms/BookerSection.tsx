import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import FeeBasisFields from './FeeBasisFields.tsx'
import { lineHeadCellSx, lineTableSx } from '../lineTableSx.ts'
import type { FeeBasis } from '../../../dealTerms.ts'
import type { GigDetailForm } from '../types.ts'

interface Props {
  editable: boolean
  form: GigDetailForm
  onChange: (field: string, value: unknown) => void
}

const BOOKING_FEE_COLUMNS = 'repeat(3, minmax(0, 1fr))'
const COMMISSION_COLUMNS = 'repeat(3, minmax(0, 1fr))'

// What the artist owes their agency: a booking fee off the gross fee, and a
// commission off the nett fee. Both land on "Due to booker" in the statement.
export default function BookerSection({ editable, form, onChange }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const agencyBasis = form.agency_fee_basis as FeeBasis

  return (
    <>
      <Grid size={12}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1 }}>
          {t($ => $.detail.deal.bookingFee.title)}
        </Typography>
      </Grid>

      <Grid size={12}>
        <Box data-testid="booking-fee-table" sx={lineTableSx}>
          <Box data-testid="booking-fee-header" sx={{ display: 'grid', gridTemplateColumns: BOOKING_FEE_COLUMNS, bgcolor: 'action.hover' }}>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.bookingFee.basis)}
              </Typography>
            </Box>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.percentage)}
              </Typography>
            </Box>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.fixedAmount)}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: BOOKING_FEE_COLUMNS, borderTop: 1, borderColor: 'divider' }}>
            <FeeBasisFields
              basisLabel={t($ => $.detail.deal.bookingFee.basis)}
              percentageLabel={t($ => $.detail.deal.bookingFee.percentage)}
              amountLabel={t($ => $.detail.deal.bookingFee.amount)}
              basis={agencyBasis}
              percentage={form.agency_fee_percentage as string}
              amount={form.agency_fee_amount as string}
              percentageHelp={t($ => $.detail.deal.bookingFee.percentageHelp)}
              editable={editable}
              onChange={(field, value) => onChange(`agency_fee_${field}`, value)}
            />
          </Box>
        </Box>
      </Grid>

      <Grid size={12}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1 }}>
          {t($ => $.detail.deal.commission.title)}
        </Typography>
      </Grid>

      <Grid size={12}>
        <Box data-testid="commission-table" sx={lineTableSx}>
          <Box data-testid="commission-header" sx={{ display: 'grid', gridTemplateColumns: COMMISSION_COLUMNS, bgcolor: 'action.hover' }}>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.commission.basis)}
              </Typography>
            </Box>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.percentage)}
              </Typography>
            </Box>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.fixedAmount)}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: COMMISSION_COLUMNS, borderTop: 1, borderColor: 'divider' }}>
            <FeeBasisFields
              basisLabel={t($ => $.detail.deal.commission.basis)}
              percentageLabel={t($ => $.detail.deal.commission.percentage)}
              amountLabel={t($ => $.detail.deal.commission.amount)}
              basis={form.commission_basis as FeeBasis}
              percentage={form.commission_percentage as string}
              amount={form.commission_amount as string}
              percentageHelp={t($ => $.detail.deal.commission.percentageHelp)}
              editable={editable}
              onChange={(field, value) => onChange(`commission_${field}`, value)}
            />
          </Box>
        </Box>
      </Grid>
    </>
  )
}
