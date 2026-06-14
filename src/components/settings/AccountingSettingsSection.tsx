import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import DateEntryField from '../DateEntryField.tsx'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import { listAccounts, getAccountingSettings, updateAccountingSettings } from '../../api/accounts.ts'
import type { Account, AccountingSettings } from '../../types/entities.ts'

const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP']

type SettingsField = keyof typeof FIELD_TYPE

// Maps settings field → expected account type, for filtering Select options
const FIELD_TYPE: Record<string, string> = {
  receivable_account_code: 'asset',
  primary_checking_account_code: 'asset',
  cash_account_code: 'asset',
  default_revenue_account_code: 'revenue',
  payable_account_code: 'liability',
  default_reimbursement_account_code: 'liability',
  default_expense_account_code: 'expense',
  output_vat_account_code: 'liability',
  input_vat_account_code: 'asset',
}

const FIELD_LABELS: Record<string, string> = {
  receivable_account_code: 'Receivable account',
  primary_checking_account_code: 'Primary checking account',
  cash_account_code: 'Cash account',
  default_revenue_account_code: 'Default revenue account',
  payable_account_code: 'Accounts payable',
  default_reimbursement_account_code: 'Default reimbursement account',
  default_expense_account_code: 'Default expense account',
  output_vat_account_code: 'Output VAT account (sales)',
  input_vat_account_code: 'Input VAT account (purchases)',
}

interface AccountSelectProps {
  field: string
  label: string
  value?: string
  accounts?: Account[]
  onChange: (field: string, value: string | null) => void
  saving?: boolean
}

function AccountSelect({ field, label, value, accounts = [], onChange, saving }: AccountSelectProps) {
  const filtered = accounts.filter((a) => a.type === FIELD_TYPE[field] && a.is_active)
  const selectId = `accounting-${field}`
  return (
    <FormControl fullWidth size="small">
      <InputLabel id={`${selectId}-label`}>{label}</InputLabel>
      <Select
        labelId={`${selectId}-label`}
        id={selectId}
        value={value ?? ''}
        label={label}
        onChange={(e) => onChange(field, e.target.value || null)}
        disabled={saving}
      >
        <MenuItem value=""><em>None</em></MenuItem>
        {filtered.map((a) => (
          <MenuItem key={a.code} value={a.code}>{a.code} — {a.name}</MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

// Server error codes → user-facing explanations.
const SAVE_ERROR_MESSAGES: Record<string, string> = {
  account_has_open_balance:
    'This account still carries an open balance (unpaid bills, unsettled member debt or unpaid invoices). Settle them before changing the account.',
  invalid_books_closed_through: 'Enter a valid date (YYYY-MM-DD) or clear the field.',
}

export default function AccountingSettingsSection() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listAccounts(), getAccountingSettings()])
      .then(([accs, s]) => { setAccounts(accs); setSettings(s) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleChange(field: string, value: string | null) {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateAccountingSettings({ [field]: value })
      setSettings(updated)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setError(SAVE_ERROR_MESSAGES[e.code ?? ''] ?? SAVE_ERROR_MESSAGES[e.message ?? ''] ?? e.message ?? 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <AccountBalanceWalletIcon fontSize="small" color="action" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Accounting Settings
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Default accounts used when creating invoices and purchases.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      {loading || !settings ? (
        <CircularProgress size={20} />
      ) : (
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="currency-label">Currency</InputLabel>
            <Select
              labelId="currency-label"
              id="currency-select"
              value={settings.currency ?? 'EUR'}
              label="Currency"
              onChange={(e) => handleChange('currency', e.target.value)}
              disabled={saving}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {Object.keys(FIELD_LABELS).map((field) => (
            <AccountSelect
              key={field}
              field={field}
              label={FIELD_LABELS[field]}
              value={(settings as Record<string, string | undefined>)[field]}
              accounts={accounts}
              onChange={handleChange}
              saving={saving}
            />
          ))}

          <DateEntryField
            id="accounting-books-closed-through"
            label="Books closed through"
            size="small"
            fullWidth
            value={(settings.books_closed_through || '').slice(0, 10)}
            onChange={(e) => handleChange('books_closed_through', e.target.value || null)}
            disabled={saving}
            helperText="Nothing can be posted on or before this date. Leave empty to keep the books open."
            sx={undefined}
          />
        </Stack>
      )}
    </Paper>
  )
}
