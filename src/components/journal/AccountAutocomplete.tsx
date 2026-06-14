import type { SxProps, Theme } from '@mui/material/styles'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Account } from '../../types/entities.ts'

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  cost_of_goods_sold: 'Cost of Goods Sold',
  expense: 'Expenses',
}

// A saved code no longer in the active chart is surfaced as a disabled "stale"
// option, so the field never silently drops it. We model that with a local type
// that extends Account rather than mutating the shared shape.
type AccountOption = Account & { __stale?: boolean }

const accountGroup = (account: AccountOption) => ACCOUNT_TYPE_LABELS[account.type ?? ''] || 'Other'

interface AccountAutocompleteProps {
  value?: string
  accounts?: Account[]
  placeholder?: string
  label?: string
  disabled?: boolean
  onChange: (code: string) => void
  sx?: SxProps<Theme>
}

// Account picker over the full chart of accounts (all active types). A saved code
// that is no longer active/known is surfaced as a disabled "stale" option so the
// field never silently drops it — mirrors PurchaseLinesEditor's __stale handling.
export default function AccountAutocomplete({ value, accounts = [], placeholder, label, disabled, onChange, sx }: AccountAutocompleteProps) {
  const known = accounts.find((a) => a.code === value) || null
  const selected: AccountOption | null = value
    ? (known || { code: value, name: 'Inactive/unknown account', type: 'asset', __stale: true })
    : null
  const options: AccountOption[] = (selected?.__stale ? [selected, ...accounts] : accounts)
    .slice()
    .sort((a, b) => accountGroup(a).localeCompare(accountGroup(b)) || (a.code ?? '').localeCompare(b.code ?? ''))

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
