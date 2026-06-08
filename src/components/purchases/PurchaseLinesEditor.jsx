import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import MoneyInput from '../invoices/MoneyInput.jsx'
import { centsToEditableEuro } from '../invoices/invoiceFormHelpers.js'
import { TAX_RATES } from './purchaseFormHelpers.js'

function PurchaseLineRow({ line, idx, vatCents, readOnly, canRemove, patchLine, removeLine }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
          Line #{idx + 1}
        </Typography>
        {canRemove && (
          <IconButton size="small" onClick={() => removeLine(idx)} disabled={readOnly} aria-label="remove line">
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Box sx={{ mb: 2 }}>
        <TextField
          label="Description"
          size="small"
          fullWidth
          placeholder="What you have bought?"
          value={line.description}
          onChange={(e) => patchLine(idx, { description: e.target.value })}
          disabled={readOnly}
        />
      </Box>

      <Box sx={{ mb: 2 }}>
        <TextField
          label="Expense category"
          size="small"
          fullWidth
          placeholder="Select or type…"
          value={line.expense_category || ''}
          onChange={(e) => patchLine(idx, { expense_category: e.target.value })}
          disabled={readOnly}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, alignItems: 'end' }}>
        <Box>
          <FormControl size="small" fullWidth disabled={readOnly}>
            <InputLabel>Tax rate</InputLabel>
            <Select
              label="Tax rate"
              value={TAX_RATES.includes(Number(line.tax_rate)) ? Number(line.tax_rate) : ''}
              onChange={(e) => patchLine(idx, { tax_rate: Number(e.target.value) })}
              renderValue={(v) => (v === '' ? 'Select…' : `${v}%`)}
            >
              {TAX_RATES.map((rate) => (
                <MenuItem key={rate} value={rate}>{rate}%</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Box>
          <TextField
            label="VAT - amount"
            size="small"
            fullWidth
            value={centsToEditableEuro(vatCents)}
            disabled
            slotProps={{ htmlInput: { style: { textAlign: 'right' } } }}
          />
        </Box>
        <Box>
          <MoneyInput
            label="Incl. VAT"
            cents={line.amount_incl_cents}
            onChange={(c) => patchLine(idx, { amount_incl_cents: c })}
            disabled={readOnly}
            sx={{ width: '100%' }}
          />
        </Box>
      </Box>
    </Box>
  )
}

PurchaseLineRow.propTypes = {
  line: PropTypes.object.isRequired,
  idx: PropTypes.number.isRequired,
  vatCents: PropTypes.number,
  readOnly: PropTypes.bool,
  canRemove: PropTypes.bool,
  patchLine: PropTypes.func.isRequired,
  removeLine: PropTypes.func.isRequired,
}

export default function PurchaseLinesEditor({ form, totals, readOnly, patchLine, addLine, removeLine }) {
  return (
    <>
      {form.lines.map((line, idx) => (
        <PurchaseLineRow
          key={idx}
          line={line}
          idx={idx}
          vatCents={totals.perLine[idx]?.vatCents || 0}
          readOnly={readOnly}
          canRemove={form.lines.length > 1}
          patchLine={patchLine}
          removeLine={removeLine}
        />
      ))}
      <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={addLine}>
        Add line
      </Button>
    </>
  )
}

PurchaseLinesEditor.propTypes = {
  form: PropTypes.object.isRequired,
  totals: PropTypes.object.isRequired,
  readOnly: PropTypes.bool,
  patchLine: PropTypes.func.isRequired,
  addLine: PropTypes.func.isRequired,
  removeLine: PropTypes.func.isRequired,
}
