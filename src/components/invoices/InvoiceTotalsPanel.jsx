import PropTypes from 'prop-types'
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
import MoneyInput from './MoneyInput.jsx'
import SummaryRow from './SummaryRow.jsx'
import { formatEur } from '../../utils/invoiceTotals.js'

function DiscountValueInput({ form, patchForm, readOnly }) {
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

DiscountValueInput.propTypes = {
  form: PropTypes.object.isRequired,
  patchForm: PropTypes.func.isRequired,
  readOnly: PropTypes.bool,
}

function DiscountEditor({ form, patchForm, readOnly, totals, onRemove }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Typography variant="body2" sx={{ flexGrow: 1 }}>Discount</Typography>
      <DiscountValueInput form={form} patchForm={patchForm} readOnly={readOnly} />
      <Select
        size="small"
        value={form.discount_type}
        onChange={(e) => patchForm({ discount_type: e.target.value, discount_pct: 0, discount_cents: 0 })}
        disabled={readOnly}
        sx={{ minWidth: 70 }}
      >
        <MenuItem value="pct">%</MenuItem>
        <MenuItem value="eur">€</MenuItem>
      </Select>
      <Typography variant="body2" sx={{ minWidth: 80, textAlign: 'right' }}>
        {formatEur(-totals.discountCents)}
      </Typography>
      <IconButton size="small" disabled={readOnly} onClick={onRemove} aria-label="remove discount">
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

DiscountEditor.propTypes = {
  form: PropTypes.object.isRequired,
  patchForm: PropTypes.func.isRequired,
  readOnly: PropTypes.bool,
  totals: PropTypes.object.isRequired,
  onRemove: PropTypes.func.isRequired,
}

export default function InvoiceTotalsPanel({
  form, totals, appliesKor, readOnly, patchForm, discountOpen, setDiscountOpen,
}) {
  function removeDiscount() {
    patchForm({ discount_pct: 0, discount_cents: 0 })
    setDiscountOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Box sx={{ minWidth: 320 }}>
        <SummaryRow label="Subtotal" value={formatEur(totals.subtotalCents)} />
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
            Add discount
          </Button>
        )}
        {!appliesKor && totals.vatByRate.map(({ rate, cents }) => (
          <SummaryRow key={rate} label={`VAT ${rate}%`} value={formatEur(cents)} />
        ))}
        {appliesKor && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right' }}>
            Kleine ondernemersregeling — no VAT charged.
          </Typography>
        )}
        <Divider sx={{ my: 1 }} />
        <SummaryRow label={<strong>Total</strong>} value={<strong>{formatEur(totals.totalCents)}</strong>} />
      </Box>
    </Box>
  )
}

InvoiceTotalsPanel.propTypes = {
  form: PropTypes.object.isRequired,
  totals: PropTypes.object.isRequired,
  appliesKor: PropTypes.bool,
  readOnly: PropTypes.bool,
  patchForm: PropTypes.func.isRequired,
  discountOpen: PropTypes.bool.isRequired,
  setDiscountOpen: PropTypes.func.isRequired,
}
