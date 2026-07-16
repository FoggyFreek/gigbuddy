import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { searchInvoiceGigs } from '../api/invoices.ts'
import useRemoteSearch from '../hooks/useRemoteSearch.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import type { Gig } from '../types/entities.ts'

type GigOption = Gig & { booking_fee_cents?: number; has_invoice?: boolean }

interface GigPickerProps {
  value?: Gig | null
  onChange: (gig: Gig | null) => void
  disabled?: boolean
  label?: string
  autoFocus?: boolean
}

export default function GigPicker({ value, onChange, disabled, label, autoFocus }: Readonly<GigPickerProps>) {
  const { t, i18n } = useTranslation('invoices')
  const { t: tCommon } = useTranslation('common')
  const {
    inputValue,
    options,
    loading,
    tooShort,
    minChars,
    onInputChange,
    clearQuery,
  } = useRemoteSearch<GigOption>({ search: searchInvoiceGigs })

  return (
    <Autocomplete<GigOption>
      value={value || null}
      onChange={(_e, picked) => {
        onChange(picked || null)
        clearQuery()
      }}
      inputValue={inputValue}
      onInputChange={onInputChange}
      options={options}
      filterOptions={(rows) => rows}
      loading={loading}
      disabled={disabled}
      autoHighlight
      getOptionDisabled={(option) => option.has_invoice === true}
      noOptionsText={tooShort
        ? tCommon($ => $.picker.typeMinChars, { count: minChars })
        : loading
          ? tCommon($ => $.picker.searching)
          : tCommon($ => $.picker.noMatches)}
      isOptionEqualToValue={(a, b) => a?.id != null && a.id === b?.id}
      getOptionLabel={(o: GigOption) =>
        `${formatShortDate(o.event_date, i18n.resolvedLanguage)} - ${o.event_description || t($ => $.gigPicker.untitled)}`
      }
      renderOption={(props, option: GigOption) => {
        const displayVenue = option.venue ?? option.festival
        const venueName = displayVenue?.name || null
        return (
          <li {...props} key={String(option.id)}>
            <Box sx={{ display: 'flex', flexDirection: 'column', color: option.has_invoice ? 'text.disabled' : 'text.primary' }}>
              <Typography variant="body2" color="inherit">
                {formatShortDate(option.event_date, i18n.resolvedLanguage)} - {option.event_description || t($ => $.gigPicker.untitled)}
                {option.has_invoice ? ` (${t($ => $.gigPicker.alreadyHasInvoice)})` : ''}
              </Typography>
              {venueName && (
                <Typography variant="caption" color="text.secondary">
                  {venueName}{option.booking_fee_cents != null ? ` - ${formatEur(option.booking_fee_cents)}` : ''}
                </Typography>
              )}
            </Box>
          </li>
        )
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? t($ => $.gigPicker.label)}
          autoFocus={autoFocus}
          helperText=" "
        />
      )}
    />
  )
}
