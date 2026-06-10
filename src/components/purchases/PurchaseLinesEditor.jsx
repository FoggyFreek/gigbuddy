import PropTypes from 'prop-types'
import Autocomplete from '@mui/material/Autocomplete'
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
import { accountShape } from '../../propTypes/shared.js'

const ACCOUNT_TYPE_LABELS = {
  cost_of_goods_sold: 'Cost of Goods Sold',
  expense: 'Expenses',
}

// Group header shown above each block of options in the account combobox.
const accountGroup = (account) => ACCOUNT_TYPE_LABELS[account.type] || 'Expenses'

function PurchaseLineRow({ line, idx, accounts = [], vatCents, errors = {}, readOnly, canRemove, patchLine, removeLine }) {
  // A saved line can reference an account that is no longer active/expense-typed.
  // Surface it as a disabled option so the field doesn't silently drop it.
  const knownAccount = accounts.find((a) => a.code === line.account_code) || null
  const selectedAccount = line.account_code
    ? (knownAccount || { code: line.account_code, name: 'Inactive/unknown account', __stale: true })
    : null
  // groupBy needs options pre-sorted by group so each header appears once.
  const accountOptions = (selectedAccount?.__stale ? [selectedAccount, ...accounts] : accounts)
    .slice()
    .sort((a, b) => accountGroup(a).localeCompare(accountGroup(b)) || a.code.localeCompare(b.code))
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
          error={Boolean(errors.description)}
          helperText={errors.description}
        />
      </Box>

      <Box sx={{ mb: 2 }}>
        <Autocomplete
          size="small"
          fullWidth
          disabled={readOnly}
          options={accountOptions}
          value={selectedAccount}
          onChange={(_e, picked) => patchLine(idx, { account_code: picked?.code || null })}
          getOptionLabel={(o) => (o ? `${o.code} - ${o.name}` : '')}
          isOptionEqualToValue={(o, v) => o.code === v.code}
          getOptionDisabled={(o) => Boolean(o.__stale)}
          groupBy={accountGroup}
          renderGroup={(params) => (
            <li key={params.key}>
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  px: 2,
                  py: 0.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'text.secondary',
                }}
              >
                {params.group}
              </Typography>
              <ul style={{ padding: 0 }}>{params.children}</ul>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Expense account"
              placeholder="Default expense account"
              error={Boolean(errors.account_code)}
              helperText={errors.account_code}
            />
          )}
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
            error={Boolean(errors.amount_incl_cents)}
            helperText={errors.amount_incl_cents}
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
  accounts: PropTypes.arrayOf(accountShape),
  vatCents: PropTypes.number,
  errors: PropTypes.object,
  readOnly: PropTypes.bool,
  canRemove: PropTypes.bool,
  patchLine: PropTypes.func.isRequired,
  removeLine: PropTypes.func.isRequired,
}

export default function PurchaseLinesEditor({ form, totals, accounts = [], lineErrors = [], readOnly, patchLine, addLine, removeLine }) {
  return (
    <>
      {form.lines.map((line, idx) => (
        <PurchaseLineRow
          key={idx}
          line={line}
          idx={idx}
          accounts={accounts}
          vatCents={totals.perLine[idx]?.vatCents || 0}
          errors={lineErrors[idx] || {}}
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
  accounts: PropTypes.arrayOf(accountShape),
  lineErrors: PropTypes.arrayOf(PropTypes.object),
  readOnly: PropTypes.bool,
  patchLine: PropTypes.func.isRequired,
  addLine: PropTypes.func.isRequired,
  removeLine: PropTypes.func.isRequired,
}
