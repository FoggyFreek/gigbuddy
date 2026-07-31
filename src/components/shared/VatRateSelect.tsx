import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import type { SxProps, Theme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { getVatRates } from '../../utils/vatRates.ts'
import { commonVatSelection } from '../../../shared/taxCategories.js'

export interface VatSelectionPatch {
  tax_category_code: string | null
  tax_jurisdiction_code: string
}

interface VatRateSelectProps {
  id: string
  label: string
  country: string | null | undefined
  value: number | null
  onChange: (rate: number | null, taxPatch?: VatSelectionPatch) => void
  disabled?: boolean
  fullWidth?: boolean
  helperText?: string
  hideLabel?: boolean
  noVatLabel?: string
  categoryCode?: string | null
  sx?: SxProps<Theme>
}

export default function VatRateSelect({
  id,
  label,
  country,
  value,
  onChange,
  disabled = false,
  fullWidth = true,
  helperText,
  hideLabel = false,
  noVatLabel,
  categoryCode,
  sx,
}: Readonly<VatRateSelectProps>) {
  const { t } = useTranslation('common')
  const labelId = `${id}-label`
  const rates = getVatRates(country)
  const normalizedCountry = String(country ?? '').toLowerCase()
  const showsNoVat = Boolean(noVatLabel)
    && (value == null || (value === 0 && !categoryCode))

  function rateLabel(rate: number) {
    if (normalizedCountry !== 'nl') return `${rate}%`
    if (rate === 21) return t($ => $.vat.rates.standard)
    if (rate === 9) return t($ => $.vat.rates.reduced)
    if (rate === 0) return t($ => $.vat.rates.zero)
    return `${rate}%`
  }

  return (
    <FormControl size="small" fullWidth={fullWidth} disabled={disabled} sx={sx}>
      {!hideLabel && <InputLabel id={labelId}>{label}</InputLabel>}
      <Select
        id={id}
        labelId={hideLabel ? undefined : labelId}
        label={hideLabel ? undefined : label}
        inputProps={hideLabel ? { 'aria-label': label } : undefined}
        value={showsNoVat ? 'none' : (value == null ? 'none' : value)}
        onChange={(event) => {
          if (event.target.value === 'none') {
            onChange(null, normalizedCountry
              ? { tax_category_code: null, tax_jurisdiction_code: normalizedCountry }
              : undefined)
            return
          }
          const rate = Number(event.target.value)
          onChange(rate, commonVatSelection(normalizedCountry, rate) ?? undefined)
        }}
      >
        {noVatLabel && <MenuItem value="none">{noVatLabel}</MenuItem>}
        {rates.map((rate) => (
          <MenuItem key={rate} value={rate}>{rateLabel(rate)}</MenuItem>
        ))}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  )
}
