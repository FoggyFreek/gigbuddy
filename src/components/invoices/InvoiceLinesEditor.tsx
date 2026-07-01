import { useTranslation } from 'react-i18next'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import type { InvoiceForm, InvoiceFormLine } from './invoiceFormHelpers.ts'
import { computeInvoiceTotals, formatEur } from '../../utils/invoiceTotals.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import MoneyInput from './MoneyInput.tsx'

const GRID_COLUMNS = '2fr 0.6fr 1fr 0.7fr 1fr 32px'

type LineTotals = ReturnType<typeof computeInvoiceTotals>['perLine'][number]

interface InvoiceLineRowProps {
  line: InvoiceFormLine
  idx: number
  lineTotals: LineTotals
  taxInclusive?: boolean
  appliesKor?: boolean
  readOnly?: boolean
  canRemove?: boolean
  compact?: boolean
  patchLine: (idx: number, patch: Partial<InvoiceFormLine>) => void
  removeLine: (idx: number) => void
}

function InvoiceLineRow({ line, idx, lineTotals, taxInclusive, appliesKor, readOnly, canRemove, compact, patchLine, removeLine }: Readonly<InvoiceLineRowProps>) {
  const { t } = useTranslation('invoices')
  const displayCents = taxInclusive ? lineTotals.grossCents : lineTotals.netCents

  if (compact) {
    const row2Cols = appliesKor ? '0.6fr 1fr 1fr' : '0.6fr 1fr 0.7fr 1fr'
    return (
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 32px', gap: 1, alignItems: 'center', mb: 2 }}>
          <TextField
            size="small"
            label={t($ => $.lines.description)}
            placeholder={t($ => $.lines.descriptionPlaceholder)}
            value={line.description}
            onChange={(e) => patchLine(idx, { description: e.target.value })}
            disabled={readOnly}
          />
          <IconButton
            size="small"
            onClick={() => removeLine(idx)}
            disabled={readOnly || !canRemove}
            aria-label={t($ => $.lines.removeLine)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: row2Cols, gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            type="number"
            label={t($ => $.lines.quantity)}
            slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
            value={line.quantity}
            onChange={(e) => patchLine(idx, { quantity: Number(e.target.value) || 0 })}
            disabled={readOnly}
          />
          <MoneyInput
            label={t($ => $.lines.price)}
            cents={line.unit_price_cents}
            onChange={(c) => patchLine(idx, { unit_price_cents: c })}
            disabled={readOnly}
          />
          {!appliesKor && (
            <TextField
              size="small"
              type="number"
              label={t($ => $.lines.vatPercentage)}
              value={line.tax_percentage}
              onChange={(e) => patchLine(idx, { tax_percentage: Number(e.target.value) || 0 })}
              slotProps={{
                htmlInput: { min: 0, step: 1 },
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              }}
              disabled={readOnly}
            />
          )}
          <Typography variant="body2" align="right">{formatEur(displayCents)}</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: 1, alignItems: 'center', mb: 1 }}>
      <TextField
        size="small"
        placeholder={t($ => $.lines.descriptionPlaceholder)}
        value={line.description}
        onChange={(e) => patchLine(idx, { description: e.target.value })}
        disabled={readOnly}
      />
      <TextField
        size="small"
        type="number"
        slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
        value={line.quantity}
        onChange={(e) => patchLine(idx, { quantity: Number(e.target.value) || 0 })}
        disabled={readOnly}
      />
      <MoneyInput
        cents={line.unit_price_cents}
        onChange={(c) => patchLine(idx, { unit_price_cents: c })}
        disabled={readOnly}
      />
      {!appliesKor ? (
        <TextField
          size="small"
          type="number"
          value={line.tax_percentage}
          onChange={(e) => patchLine(idx, { tax_percentage: Number(e.target.value) || 0 })}
          slotProps={{
            htmlInput: { min: 0, step: 1 },
            input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
          }}
          disabled={readOnly}
        />
      ) : (
        <span />
      )}
      <Typography variant="body2" align="right">{formatEur(displayCents)}</Typography>
      <IconButton
        size="small"
        onClick={() => removeLine(idx)}
        disabled={readOnly || !canRemove}
        aria-label={t($ => $.lines.removeLine)}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

interface InvoiceLinesEditorProps {
  form: InvoiceForm
  totals: ReturnType<typeof computeInvoiceTotals>
  appliesKor?: boolean
  readOnly?: boolean
  patchForm: (patch: Partial<InvoiceForm>) => void
  patchLine: (idx: number, patch: Partial<InvoiceFormLine>) => void
  addLine: () => void
  removeLine: (idx: number) => void
}

export default function InvoiceLinesEditor({ form, totals, appliesKor, readOnly, patchForm, patchLine, addLine, removeLine }: Readonly<InvoiceLinesEditorProps>) {
  const { t } = useTranslation('invoices')
  const compact = useCompactLayout()
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>{t($ => $.lines.title)}</Typography>
        {!appliesKor && (
          <ToggleButtonGroup
            value={form.tax_inclusive ? 'inclusive' : 'exclusive'}
            exclusive
            size="small"
            onChange={(_e, v) => v && patchForm({ tax_inclusive: v === 'inclusive' })}
            disabled={readOnly}
          >
            <ToggleButton value="inclusive">{t($ => $.lines.inclusiveVat)}</ToggleButton>
            <ToggleButton value="exclusive">{t($ => $.lines.exclusiveVat)}</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      {!compact && (
        <Box sx={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: 1, alignItems: 'center', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">{t($ => $.lines.description)}</Typography>
          <Typography variant="caption" color="text.secondary" align="right">{t($ => $.lines.quantity)}</Typography>
          <Typography variant="caption" color="text.secondary" align="right">{t($ => $.lines.price)}</Typography>
          {!appliesKor
            ? <Typography variant="caption" color="text.secondary" align="right">{t($ => $.lines.vatPercentage)}</Typography>
            : <span />}
          <Typography variant="caption" color="text.secondary" align="right">{t($ => $.labels.total)}</Typography>
          <span />
        </Box>
      )}

      {form.lines.map((line, idx) => (
        <InvoiceLineRow
          key={line._key}
          line={line}
          idx={idx}
          lineTotals={totals.perLine[idx] || { grossCents: 0, netCents: 0, taxCents: 0 }}
          taxInclusive={form.tax_inclusive}
          appliesKor={appliesKor}
          readOnly={readOnly}
          canRemove={form.lines.length > 1}
          compact={compact}
          patchLine={patchLine}
          removeLine={removeLine}
        />
      ))}

      <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={addLine}>
        {t($ => $.lines.addItem)}
      </Button>
    </>
  )
}
