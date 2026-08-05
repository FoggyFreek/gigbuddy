import { useTranslation } from 'react-i18next'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { VAT_COUNTRY_CODES } from '../../utils/vatRates.ts'

// Localized country name from the 2-letter code, so the accounting-country
// dropdown reads naturally without hand-maintained i18n keys.
function countryLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase())
    return name ? `${name} (${code.toUpperCase()})` : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

interface AccountingCountrySelectProps {
  value: string
  onChange: (code: string) => void
  label: string
  helperText?: string
  /** Fixed once the tenant exists — the country is immutable afterwards. */
  disabled?: boolean
}

// The tenant's bookkeeping jurisdiction: asked once at creation, never
// defaulted, and immutable afterwards. Shared by every creation path so the
// option list and formatting can't drift between them.
export default function AccountingCountrySelect({
  value, onChange, label, helperText, disabled = false,
}: Readonly<AccountingCountrySelectProps>) {
  const { i18n } = useTranslation()

  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      fullWidth
      helperText={helperText}
    >
      {VAT_COUNTRY_CODES.map((code) => (
        <MenuItem key={code} value={code}>{countryLabel(code, i18n.language)}</MenuItem>
      ))}
    </TextField>
  )
}
