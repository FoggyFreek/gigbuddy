import type { SxProps, Theme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import type { InvoiceForm } from './invoiceFormHelpers.ts'
import { computeInvoiceTotals } from '../../utils/invoiceTotals.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import MoneyInput from './MoneyInput.tsx'
import SummaryRow from './SummaryRow.tsx'
import { formatEur } from '../../utils/invoiceTotals.ts'

type InvoiceTotals = ReturnType<typeof computeInvoiceTotals>

interface DiscountValueInputProps {
  form: InvoiceForm
  patchForm: (patch: Partial<InvoiceForm>) => void
  readOnly?: boolean
}

function DiscountValueInput({ form, patchForm, readOnly }: DiscountValueInputProps) {
  if (form.discount_type === 'pct') {
    return (
      <TextField
        size="small"
        type="number"
        sx={{ width: 80 }}
        value={form.discount_pct}
        onChange={(e) => patchForm({ discount_pct: Math.max(0, Number(e.target.value) || 0) })}
        slotProps={{ htmlInput: { min: 0, max: 100, step: 0.01 } }}
        disabled={readOnly}
      />
    )
  }
  return (
    <MoneyInput
      cents={form.discount_cents}
      onChange={(c) => patchForm({ discount_cents: c })}
      disabled={readOnly}
      sx={{ width: 80 }}
    />
  )
}

interface DiscountEditorProps {
  form: InvoiceForm
  patchForm: (patch: Partial<InvoiceForm>) => void
  readOnly?: boolean
  totals: InvoiceTotals
  onRemove: () => void
}

function DiscountEditor({ form, patchForm, readOnly, totals, onRemove }: DiscountEditorProps) {
  const { t } = useTranslation('invoices')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Typography variant="body2" sx={{ flexGrow: 1 }}>{t($ => $.totals.discount)}</Typography>
      <DiscountValueInput form={form} patchForm={patchForm} readOnly={readOnly} />
      <Select
        size="small"
        value={form.discount_type}
        onChange={(e) => patchForm({ discount_type: e.target.value as 'pct' | 'eur', discount_pct: 0, discount_cents: 0 })}
        disabled={readOnly}
        sx={{ minWidth: 70 }}
      >
        <MenuItem value="pct">%</MenuItem>
        <MenuItem value="eur">€</MenuItem>
      </Select>
      <Typography variant="body2" sx={{ minWidth: 80, textAlign: 'right' }}>
        {formatEur(-totals.discountCents)}
      </Typography>
      <IconButton size="small" disabled={readOnly} onClick={onRemove} aria-label={t($ => $.totals.removeDiscount)}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

interface InvoiceTotalsPanelProps {
  form: InvoiceForm
  totals: InvoiceTotals
  appliesKor?: boolean
  readOnly?: boolean
  patchForm: (patch: Partial<InvoiceForm>) => void
  discountOpen: boolean
  setDiscountOpen: (open: boolean) => void
}

export default function InvoiceTotalsPanel({
  form, totals, appliesKor, readOnly, patchForm, discountOpen, setDiscountOpen,
}: InvoiceTotalsPanelProps) {
  const { t } = useTranslation('invoices')
  function removeDiscount() {
    patchForm({ discount_pct: 0, discount_cents: 0 })
    setDiscountOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Box sx={{ minWidth: 320 }}>
        <SummaryRow label={t($ => $.totals.subtotal)} value={formatEur(totals.subtotalCents)} />
        {discountOpen ? (
          <DiscountEditor
            form={form}
            patchForm={patchForm}
            readOnly={readOnly}
            totals={totals}
            onRemove={removeDiscount}
          />
        ) : (
          <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={() => setDiscountOpen(true)}>
            {t($ => $.totals.addDiscount)}
          </Button>
        )}
        {!appliesKor && totals.vatByRate.map(({ rate, cents }) => (
          <SummaryRow key={rate} label={t($ => $.totals.vatRate, { rate })} value={formatEur(cents)} />
        ))}
        {appliesKor && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right' }}>
            {t($ => $.totals.korNotice)}
          </Typography>
        )}
        <Divider sx={{ my: 1 }} />
        <SummaryRow label={<strong>{t($ => $.labels.total)}</strong>} value={<strong>{formatEur(totals.totalCents)}</strong>} />
      </Box>
    </Box>
  )
}
