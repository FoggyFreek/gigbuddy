import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { lineCellSx, lineFieldSx, lineHeadCellSx, lineTableSx } from '../lineTableSx.ts'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import FieldHelpAdornment from '../FieldHelpAdornment.tsx'
import { useAccountingProfile } from '../../../../../contexts/accountingProfileContext.ts'
import { getReducedVatRate } from '../../../../../finance/vat/vatRates.ts'
import type { GigDetailForm } from '../types.ts'

interface Props {
  editable: boolean
  form: GigDetailForm
  onChange: (field: string, value: unknown) => void
}

const TAX_COLUMNS = 'repeat(3, minmax(0, 1fr))'

// The two VAT rates of a deal, and whether it carries VAT at all. The general
// rate overrides what an invoice generated from this gig is billed at; the
// ticket rate is the venue's VAT contained in the nett ticket price, which
// every ticket calculation takes out before anyone shares in the door.
export default function TaxesSection({ editable, form, onChange }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const { accountingCountry } = useAccountingProfile()
  const subjectToVat = form.subject_to_vat as boolean
  // What an invoice falls back to when the deal names no rate of its own.
  const defaultRate = getReducedVatRate(accountingCountry)

  return (
    <>
      <Grid size={12}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1 }}>
          {t($ => $.detail.deal.taxes.title)}
        </Typography>
      </Grid>

      <Grid size={12}>
        <Box data-testid="tax-table" sx={lineTableSx}>
          <Box sx={{ display: 'grid', gridTemplateColumns: TAX_COLUMNS, bgcolor: 'action.hover' }}>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.taxes.subjectToVat)}
              </Typography>
            </Box>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.taxes.generalVat)}
              </Typography>
            </Box>
            <Box sx={lineHeadCellSx}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t($ => $.detail.deal.taxes.ticketVat)}
              </Typography>
            </Box>
          </Box>

          {/* A deal that carries no VAT still shows both rates — greyed out,
              not hidden — so the table's columns never move. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: TAX_COLUMNS, borderTop: 1, borderColor: 'divider' }}>
            <Box sx={{ ...lineCellSx, justifyContent: 'center' }}>
              <Checkbox
                checked={subjectToVat}
                disabled={!editable}
                onChange={(event) => onChange('subject_to_vat', event.target.checked)}
                slotProps={{ input: { 'aria-label': t($ => $.detail.deal.taxes.subjectToVat) } }}
              />
            </Box>

            <Box sx={lineCellSx}>
              <TextField
                variant="standard"
                type="number"
                fullWidth
                value={form.vat_percentage}
                disabled={!subjectToVat}
                onChange={(event) => onChange('vat_percentage', event.target.value)}
                placeholder={String(defaultRate)}
                sx={{ ...lineFieldSx, ...NO_NUMBER_SPINNER_SX }}
                slotProps={{
                  htmlInput: {
                    min: 0, max: 100, step: 0.5, readOnly: !editable, 'aria-label': t($ => $.detail.deal.taxes.generalVat),
                  },
                  input: {
                    disableUnderline: true,
                    endAdornment: (
                      <FieldHelpAdornment help={t($ => $.detail.deal.taxes.generalVatHelp, { rate: defaultRate })}>
                        %
                      </FieldHelpAdornment>
                    ),
                  },
                }}
              />
            </Box>

            <Box sx={lineCellSx}>
              <TextField
                variant="standard"
                type="number"
                fullWidth
                value={form.ticket_vat_percentage}
                disabled={!subjectToVat}
                onChange={(event) => onChange('ticket_vat_percentage', event.target.value)}
                placeholder="0"
                sx={{ ...lineFieldSx, ...NO_NUMBER_SPINNER_SX }}
                slotProps={{
                  htmlInput: {
                    min: 0, max: 100, step: 0.5, readOnly: !editable, 'aria-label': t($ => $.detail.deal.taxes.ticketVat),
                  },
                  input: {
                    disableUnderline: true,
                    endAdornment: (
                      <FieldHelpAdornment help={t($ => $.detail.deal.taxes.ticketVatHelp)}>%</FieldHelpAdornment>
                    ),
                  },
                }}
              />
            </Box>
          </Box>
        </Box>
      </Grid>
    </>
  )
}
