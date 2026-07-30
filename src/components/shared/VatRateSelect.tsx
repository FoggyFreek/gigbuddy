import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import type { SxProps, Theme } from '@mui/material/styles'
import { getVatRates } from '../../utils/vatRates.ts'

interface VatRateSelectProps {
  id: string
  label: string
  country: string | null | undefined
  value: number | null
  onChange: (rate: number | null) => void
  disabled?: boolean
  fullWidth?: boolean
  helperText?: string
  hideLabel?: boolean
  noVatLabel?: string
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
  sx,
}: Readonly<VatRateSelectProps>) {
  const labelId = `${id}-label`
  const rates = getVatRates(country).filter((rate) => !noVatLabel || rate !== 0)

  return (
    <FormControl size="small" fullWidth={fullWidth} disabled={disabled} sx={sx}>
      {!hideLabel && <InputLabel id={labelId}>{label}</InputLabel>}
      <Select
        id={id}
        labelId={hideLabel ? undefined : labelId}
        label={hideLabel ? undefined : label}
        inputProps={hideLabel ? { 'aria-label': label } : undefined}
        value={value == null ? 'none' : value}
        onChange={(event) => onChange(event.target.value === 'none' ? null : Number(event.target.value))}
      >
        {noVatLabel && <MenuItem value="none">{noVatLabel}</MenuItem>}
        {rates.map((rate) => (
          <MenuItem key={rate} value={rate}>{rate}%</MenuItem>
        ))}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  )
}
