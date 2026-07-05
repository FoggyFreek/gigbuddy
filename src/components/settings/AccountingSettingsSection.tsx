import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { listAccounts, getAccountingSettings, updateAccountingSettings } from '../../api/accounts.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import type { Account, AccountingSettings } from '../../types/entities.ts'

const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP']

// Maps settings field → expected account type, for filtering Select options.
// The `as const` keeps the keys a literal union so the i18n selector index
// (`$.fields[field]`) type-checks.
const FIELD_TYPE = {
  receivable_account_code: 'asset',
  primary_checking_account_code: 'asset',
  cash_account_code: 'asset',
  default_revenue_account_code: 'revenue',
  payable_account_code: 'liability',
  default_reimbursement_account_code: 'liability',
  default_expense_account_code: 'expense',
  output_vat_account_code: 'liability',
  input_vat_account_code: 'asset',
  merch_revenue_account_code: 'revenue',
} as const

type AccountField = keyof typeof FIELD_TYPE

interface AccountSelectProps {
  field: AccountField
  label: string
  value?: string
  accounts?: Account[]
  onChange: (field: AccountField, value: string | null) => void
  saving?: boolean
}

function AccountSelect({ field, label, value, accounts = [], onChange, saving }: Readonly<AccountSelectProps>) {
  const { t } = useTranslation('common')
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
        <MenuItem value=""><em>{t($ => $.state.none)}</em></MenuItem>
        {filtered.map((a) => (
          <MenuItem key={a.code} value={a.code}>{a.code} — {a.name}</MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

export default function AccountingSettingsSection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()
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

  async function handleChange(field: AccountField | 'currency' | 'books_closed_through', value: string | null) {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateAccountingSettings({ [field]: value })
      setSettings(updated)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const code = e.code ?? e.message ?? ''
      if (code === 'account_has_open_balance' || code === 'invalid_books_closed_through') {
        setError(t($ => $.accounting.errors[code]))
      } else {
        setError(e.message ?? t($ => $.accounting.errors.unknown))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3}}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.accounting.title)}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.accounting.description)}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      {loading || !settings ? (
        <CircularProgress size={20} />
      ) : (
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="currency-label">{t($ => $.accounting.currency)}</InputLabel>
            <Select
              labelId="currency-label"
              id="currency-select"
              value={settings.currency ?? 'EUR'}
              label={t($ => $.accounting.currency)}
              onChange={(e) => handleChange('currency', e.target.value)}
              disabled={saving}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {(Object.keys(FIELD_TYPE) as AccountField[]).map((field) => (
            <AccountSelect
              key={field}
              field={field}
              label={t($ => $.accounting.fields[field])}
              value={(settings as Record<string, string | undefined>)[field]}
              accounts={accounts}
              onChange={handleChange}
              saving={saving}
            />
          ))}

          <DateEntryField
            id="accounting-books-closed-through"
            label={t($ => $.accounting.booksClosedThrough)}
            size="small"
            fullWidth
            value={(settings.books_closed_through || '').slice(0, 10)}
            onChange={(e) => handleChange('books_closed_through', e.target.value || null)}
            disabled={saving}
            helperText={t($ => $.accounting.booksClosedThroughHelper)}
            sx={undefined}
          />
        </Stack>
      )}
    </Paper>
  )
}
