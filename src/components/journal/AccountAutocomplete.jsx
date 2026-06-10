import PropTypes from 'prop-types'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { accountShape } from '../../propTypes/shared.js'

const ACCOUNT_TYPE_LABELS = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  cost_of_goods_sold: 'Cost of Goods Sold',
  expense: 'Expenses',
}

const accountGroup = (account) => ACCOUNT_TYPE_LABELS[account.type] || 'Other'

// Account picker over the full chart of accounts (all active types). A saved code
// that is no longer active/known is surfaced as a disabled "stale" option so the
// field never silently drops it — mirrors PurchaseLinesEditor's __stale handling.
export default function AccountAutocomplete({ value, accounts = [], placeholder, label, disabled, onChange, sx }) {
  const known = accounts.find((a) => a.code === value) || null
  const selected = value
    ? (known || { code: value, name: 'Inactive/unknown account', type: 'asset', __stale: true })
    : null
  const options = (selected?.__stale ? [selected, ...accounts] : accounts)
    .slice()
    .sort((a, b) => accountGroup(a).localeCompare(accountGroup(b)) || a.code.localeCompare(b.code))

  return (
    <Autocomplete
      size="small"
      fullWidth
      sx={sx}
      disabled={disabled}
      options={options}
      value={selected}
      onChange={(_e, picked) => onChange(picked?.code || '')}
      getOptionLabel={(o) => (o ? `${o.code} - ${o.name}` : '')}
      isOptionEqualToValue={(o, v) => o.code === v.code}
      getOptionDisabled={(o) => Boolean(o.__stale)}
      groupBy={accountGroup}
      renderGroup={(params) => (
        <li key={params.key}>
          <Typography
            variant="caption"
            sx={{
              display: 'block', px: 2, py: 0.5, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary',
            }}
          >
            {params.group}
          </Typography>
          <ul style={{ padding: 0 }}>{params.children}</ul>
        </li>
      )}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} />
      )}
    />
  )
}

AccountAutocomplete.propTypes = {
  value: PropTypes.string,
  accounts: PropTypes.arrayOf(accountShape),
  placeholder: PropTypes.string,
  label: PropTypes.string,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  sx: PropTypes.object,
}
