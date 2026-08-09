import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import { COUNTRY_CODES, countryLabel } from '../../utils/countries.ts'

interface CountrySelectProps {
  value: string
  onChange: (code: string) => void
  label: string
  helperText?: string
  error?: boolean
  disabled?: boolean
  required?: boolean
}

/**
 * Where a band comes from — the full ISO 3166-1 list, not the ten VAT
 * jurisdictions AccountingCountrySelect offers. An Autocomplete rather than a
 * Select because 249 options are unusable in a dropdown, and typing a country's
 * name is how anyone actually finds one.
 */
export default function CountrySelect({
  value, onChange, label, helperText, error = false, disabled = false, required = false,
}: Readonly<CountrySelectProps>) {
  const { i18n } = useTranslation()

  // Sorted by the viewer's own language, so the list reads in their alphabet
  // rather than in code order.
  const options = useMemo(
    () => [...COUNTRY_CODES].sort((a, b) =>
      countryLabel(a, i18n.language).localeCompare(countryLabel(b, i18n.language), i18n.language)),
    [i18n.language],
  )

  return (
    <Autocomplete
      options={options}
      value={value || null}
      onChange={(_event, code) => onChange(code ?? '')}
      getOptionLabel={(code) => `${countryLabel(code, i18n.language)} (${code.toUpperCase()})`}
      disabled={disabled}
      fullWidth
      autoHighlight
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          helperText={helperText}
          error={error}
          required={required}
        />
      )}
    />
  )
}
