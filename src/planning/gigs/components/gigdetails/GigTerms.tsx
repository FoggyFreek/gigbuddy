import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { useTranslation } from 'react-i18next'
import BookerSection from './terms/BookerSection.tsx'
import DealSection from './terms/DealSection.tsx'
import GigCostsEditor from './terms/GigCostsEditor.tsx'
import TaxesSection from './terms/TaxesSection.tsx'
import TicketUpside from './terms/TicketUpside.tsx'
import { dealTermsFromForm } from './gigFormFields.ts'
import { usePermissions } from '../../../../hooks/usePermissions.ts'
import type { CostPaidBy, GigCost, Id } from '../../../../types/entities.ts'
import type { GigDetailForm } from './types.ts'

interface Props {
  editable: boolean
  form: GigDetailForm
  costs: GigCost[]
  onChange: (field: string, value: unknown) => void
  onAddCost: (label: string, amountCents: number, paidBy: CostPaidBy) => Promise<void>
  onUpdateCost: (costId: Id, label: string, amountCents: number, paidBy: CostPaidBy) => Promise<void>
  onDeleteCost: (costId: Id) => Promise<void>
}

export default function GigTerms({
  editable,
  form,
  costs,
  onChange,
  onAddCost,
  onUpdateCost,
  onDeleteCost,
}: Readonly<Props>) {
  const { t } = useTranslation(['gigs', 'common'])
  const { canViewFinance } = usePermissions()

  // Derived from the form rather than the saved row, so the statement and the
  // simulation track what is being typed instead of lagging the debounced save.
  const dealTerms = dealTermsFromForm(form, costs)

  return (
    <Grid container spacing={2}>
      {canViewFinance && (
        <>
          <DealSection editable={editable} form={form} onChange={onChange} />
          {/* Always offered: the deal type says whether tickets are sold,
              so there is no separate paid-admission flag to gate this on. */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t($ => $.detail.ticketLink)}
              type="url"
              fullWidth
              value={form.ticket_link}
              onChange={(event) => onChange('ticket_link', event.target.value)}
              slotProps={{
                htmlInput: { readOnly: !editable },
                input: {
                  endAdornment: form.ticket_link ? (
                    <InputAdornment position="end">
                      <Tooltip title={t($ => $.detail.openLink)}>
                        <IconButton
                          size="small"
                          edge="end"
                          component="a"
                          href={form.ticket_link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
          </Grid>

          <TicketUpside terms={dealTerms} />

          <GigCostsEditor
            editable={editable}
            costs={costs}
            onAdd={onAddCost}
            onUpdate={onUpdateCost}
            onDelete={onDeleteCost}
          />

          <BookerSection editable={editable} form={form} onChange={onChange} />

          <TaxesSection editable={editable} form={form} onChange={onChange} />
        </>
      )}
    </Grid>
  )
}
