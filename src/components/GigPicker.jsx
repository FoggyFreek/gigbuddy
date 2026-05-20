import { useEffect, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { listGigs } from '../api/gigs.js'
import { formatShortDate } from '../utils/dateFormat.js'
import { formatEur } from '../utils/invoiceTotals.js'

export default function GigPicker({ value, onChange, disabled, label = 'Gig', autoFocus }) {
  const [gigs, setGigs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listGigs()
      .then((rows) => {
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
      getOptionLabel={(o) =>
        `${formatShortDate(o.event_date)} - ${o.event_description || '(untitled)'}`
      }
      renderOption={(props, option) => {
        const venueName = option.venue?.name ||
          (option.venue?.category === 'festival' ? option.venue?.festival_name : null)
        return (
          <li {...props} key={option.id}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2">
                {formatShortDate(option.event_date)} - {option.event_description || '(untitled)'}
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
          label={label}
          autoFocus={autoFocus}
          helperText={!loading && !gigs.length ? 'No gigs yet - create one first' : ' '}
        />
      )}
    />
  )
}
