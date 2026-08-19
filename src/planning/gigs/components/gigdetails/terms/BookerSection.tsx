import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import FeeBasisFields from './FeeBasisFields.tsx'
import FieldHelpAdornment from '../FieldHelpAdornment.tsx'
import { useCompactLayout } from '../../../../../hooks/useCompactLayout.ts'
import { AGENCY_FEE_MODES } from '../../../dealTerms.ts'
import type { AgencyFeeMode, FeeBasis } from '../../../dealTerms.ts'
import type { GigDetailForm } from '../types.ts'

// Each block is one line of fields, however many the basis asks for, so they
// share the line evenly instead of falling into fixed grid columns.
const fieldRowSx = { '& > .MuiFormControl-root': { flex: 1, minWidth: 0 } } as const

interface Props {
  editable: boolean
  form: GigDetailForm
  onChange: (field: string, value: unknown) => void
}

// What the artist owes their agency: a booking fee off the gross fee, and a
// commission off the nett fee. Both land on "Due to booker" in the statement.
export default function BookerSection({ editable, form, onChange }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const isCompact = useCompactLayout()
  const agencyBasis = form.agency_fee_basis as FeeBasis
  const agencyMode = form.agency_fee_mode as AgencyFeeMode

  return (
    <>
      <Grid size={12}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1 }}>
          {t($ => $.detail.deal.bookingFee.title)}
        </Typography>
      </Grid>

      <Grid size={12}>
        <Stack
          data-testid="booking-fee-fields"
          direction={isCompact ? 'column' : 'row'}
          spacing={2}
          sx={fieldRowSx}
        >
          <FeeBasisFields
            basisLabel={t($ => $.detail.deal.bookingFee.basis)}
            basis={agencyBasis}
            percentage={form.agency_fee_percentage as string}
            amount={form.agency_fee_amount as string}
            percentageHelp={t($ => $.detail.deal.bookingFee.percentageHelp)}
            editable={editable}
            onChange={(field, value) => onChange(`agency_fee_${field}`, value)}
          />

          {agencyBasis !== 'none' && (
            <TextField
              select
              label={t($ => $.detail.deal.bookingFee.mode)}
              fullWidth
              value={agencyMode}
              disabled={!editable}
              onChange={(event) => onChange('agency_fee_mode', event.target.value)}
              slotProps={{
                input: {
                  // Worked through in an example, so it explains the mode that is
                  // selected rather than both at once.
                  endAdornment: (
                    <FieldHelpAdornment help={t($ => $.detail.deal.bookingFee.modeHelp[agencyMode])} />
                  ),
                },
              }}
            >
              {AGENCY_FEE_MODES.map((mode) => (
                <MenuItem key={mode} value={mode}>{t($ => $.detail.deal.bookingFee.modes[mode])}</MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      </Grid>

      <Grid size={12}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1 }}>
          {t($ => $.detail.deal.commission.title)}
        </Typography>
      </Grid>

      <Grid size={12}>
        <Stack
          data-testid="commission-fields"
          direction={isCompact ? 'column' : 'row'}
          spacing={2}
          sx={fieldRowSx}
        >
          <FeeBasisFields
            basisLabel={t($ => $.detail.deal.commission.basis)}
            basis={form.commission_basis as FeeBasis}
            percentage={form.commission_percentage as string}
            amount={form.commission_amount as string}
            percentageHelp={t($ => $.detail.deal.commission.percentageHelp)}
            editable={editable}
            onChange={(field, value) => onChange(`commission_${field}`, value)}
          />
        </Stack>
      </Grid>
    </>
  )
}
