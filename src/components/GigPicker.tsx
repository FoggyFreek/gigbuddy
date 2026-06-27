import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { listGigs } from '../api/gigs.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import type { Gig } from '../types/entities.ts'

type GigOption = Gig & { booking_fee_cents?: number }

interface GigPickerProps {
  value?: Gig | null
  onChange: (gig: Gig | null) => void
  disabled?: boolean
  label?: string
  autoFocus?: boolean
}

export default function GigPicker({ value, onChange, disabled, label, autoFocus }: GigPickerProps) {
  const { t, i18n } = useTranslation('invoices')
  const [gigs, setGigs] = useState<GigOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listGigs()
      .then((rows: GigOption[]) => {
        if (cancelled) return
        setGigs(Array.isArray(rows) ? rows : [])
      })
      .catch(() => { if (!cancelled) setGigs([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <Autocomplete
      value={value || null}
      onChange={(_e, picked) => onChange(picked || null)}
      options={gigs}
      loading={loading}
      disabled={disabled}
      autoHighlight
      isOptionEqualToValue={(a, b) => a?.id != null && a.id === b?.id}
      getOptionLabel={(o: GigOption) =>
        `${formatShortDate(o.event_date, i18n.resolvedLanguage)} - ${o.event_description || t($ => $.gigPicker.untitled)}`
      }
      renderOption={(props, option: GigOption) => {
        const displayVenue = option.venue ?? option.festival
        const venueName = displayVenue?.name || null
        return (
          <li {...props} key={String(option.id)}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2">
                {formatShortDate(option.event_date, i18n.resolvedLanguage)} - {option.event_description || t($ => $.gigPicker.untitled)}
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
          helperText={!loading && !gigs.length ? t($ => $.gigPicker.empty) : ' '}
        />
      )}
    />
  )
}
