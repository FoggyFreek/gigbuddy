import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PropTypes from 'prop-types'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { searchVenues } from '../api/venues.js'
import { venueHeadline, venueOptionLabel } from '../utils/venueDisplay.js'
import { idProp, venueShape } from '../propTypes/shared.js'
import VenueFormModal from './VenueFormModal.jsx'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

// Two modes:
//  - Bound field (default): controlled by value/onChange, used in gig flows.
//  - Add control: pass onSelect (and optionally excludeIds) to operate like
//    ContactPicker — value is forced null, each pick is reported via onSelect
//    and the input is cleared, and already-linked ids are filtered out of
//    results so a duplicate link can't be picked.
export default function VenuePicker({ value, onChange, onSelect, excludeIds = [], disabled, label, categoryFilter }) {
  const navigate = useNavigate()
  const [input, setInput] = useState('')   // what the field displays
  const [query, setQuery] = useState('')   // what we actually search on
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [createPrefill, setCreatePrefill] = useState(null) // { name, category } | null
  const reqIdRef = useRef(0)

  const addMode = typeof onSelect === 'function'
  const effectiveValue = addMode ? null : (value ?? null)
  // Key the search effect on the exclude list's *contents*, not the array's
  // identity: callers (e.g. the gig flow) often rely on the default `[]`, which
  // is a fresh array each render. Depending on identity would re-fire the search
  // effect every render in a loop (perpetual "Searching…" that hides the create
  // row). The Set is rebuilt inside the effect, gated by this stable string key.
  const excludeKey = excludeIds.join(',')

  const defaultLabel = categoryFilter === 'festival' ? 'Festival / event organisation' : 'Venue / physical location'
  const resolvedLabel = label ?? defaultLabel

  // Search on `query`, not `input`: MUI mirrors a picked value's label back into
  // the field via an onInputChange 'reset', and that label is not a user query.
  // Feeding it to the search effect fires a wasted /venues/search on every mount
  // with a bound value and on every pick.
  const trimmed = query.trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
    const excluded = new Set(excludeIds)
    if (tooShort) {
      const handle = setTimeout(() => {
        if (reqIdRef.current !== myReqId) return
        setOptions([])
        setLoading(false)
      }, 0)
      return () => clearTimeout(handle)
    }
    const startHandle = setTimeout(() => {
      if (reqIdRef.current !== myReqId) return
      setLoading(true)
    }, 0)
    const handle = setTimeout(() => {
      searchVenues(trimmed, categoryFilter)
        .then((rows) => {
          if (reqIdRef.current !== myReqId) return
          setOptions(rows.filter((r) => !excluded.has(r.id)))
        })
        .catch(() => {
          if (reqIdRef.current !== myReqId) return
          setOptions([])
        })
        .finally(() => {
          if (reqIdRef.current !== myReqId) return
          setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(startHandle)
      clearTimeout(handle)
    }
    // excludeKey stands in for excludeIds (stable across renders by contents).
  }, [trimmed, tooShort, categoryFilter, excludeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const augmentedOptions = useMemo(() => {
    if (tooShort || loading) return options
    if (options.length > 0) return options
    if (effectiveValue) return options
    if (categoryFilter === 'festival') {
      return [{ __action: 'create-festival', __label: `+ Create festival '${trimmed}'` }]
    }
    if (categoryFilter === 'venue') {
      return [{ __action: 'create-venue', __label: `+ Create venue '${trimmed}'` }]
    }
    return [
      { __action: 'create-venue', __label: `+ Create venue '${trimmed}'` },
      { __action: 'create-festival', __label: `+ Create festival '${trimmed}'` },
    ]
  }, [options, tooShort, loading, trimmed, effectiveValue, categoryFilter])

  // Report a picked/created venue through whichever mode is active. In add mode
  // we also clear the field so it's ready for the next addition; in bound mode
  // onChange owns the value.
  function report(venue) {
    if (addMode) {
      onSelect(venue)
      setInput('')
      setQuery('')
      setOptions([])
    } else {
      onChange?.(venue)
    }
  }

  function handleSelect(_event, picked) {
    if (!picked) {
      if (!addMode) onChange?.(null)
      return
    }
    if (picked.__action === 'create-venue') {
      setCreatePrefill({ name: trimmed, category: 'venue' })
      return
    }
    if (picked.__action === 'create-festival') {
      setCreatePrefill({ name: trimmed, category: 'festival' })
      return
    }
    report(picked)
  }

  function handleCreated(venue) {
    setCreatePrefill(null)
    setInput('')
    setQuery('')
    setOptions([])
    if (categoryFilter && venue.category !== categoryFilter) return
    report(venue)
  }

  return (
    <>
      <Autocomplete
        value={effectiveValue}
        onChange={handleSelect}
        inputValue={input}
        onInputChange={(_e, v, reason) => {
          if (reason === 'input') { setInput(v); setQuery(v) }
          else if (reason === 'reset') setInput(v) // display only — not a search
          else if (reason === 'clear') { setInput(''); setQuery('') }
        }}
        options={augmentedOptions}
        filterOptions={(x) => x}
        loading={loading}
        disabled={disabled}
        getOptionLabel={(o) =>
          o?.__action ? o.__label : venueOptionLabel(o)
        }
        isOptionEqualToValue={(a, b) => a?.id != null && a.id === b?.id}
        noOptionsText={
          tooShort
            ? `Type at least ${MIN_CHARS} characters…`
            : loading
              ? 'Searching…'
              : 'No matches'
        }
        renderOption={(props, option) => {
          if (option.__action) {
            return (
              <li {...props} key={option.__action}>
                <Typography variant="body2" color="primary">{option.__label}</Typography>
              </li>
            )
          }
          const subtitle = [option.city, option.region, option.country].filter(Boolean).join(', ')
          return (
            <li {...props} key={option.id}>
              <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                <Typography variant="body2">{venueHeadline(option)}</Typography>
                {subtitle && (
                  <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {option.category === 'festival' ? '(festival)' : '(venue)'}
              </Typography>
            </li>
          )
        }}
        renderInput={(params) => {
          const extra = effectiveValue?.id ? (
            <InputAdornment position="end" sx={{ m: 0, mr: -1 }}>
              <Tooltip title="Open venue">
                <IconButton
                  size="small"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/venues/${effectiveValue.id}`)
                  }}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : null
          const inputSlotProps = params.slotProps?.input ?? params.InputProps ?? {}
          return (
            <TextField
              {...params}
              label={resolvedLabel}
              slotProps={{
                ...params.slotProps,
                input: {
                  ...inputSlotProps,
                  endAdornment: (
                    <>
                      {extra}
                      {inputSlotProps.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )
        }}
      />
      {createPrefill && (
        <VenueFormModal
          mode="create"
          initial={createPrefill}
          onCreated={handleCreated}
          onClose={() => setCreatePrefill(null)}
          lockedCategory={categoryFilter || undefined}
        />
      )}
    </>
  )
}

VenuePicker.propTypes = {
  value: venueShape,
  onChange: PropTypes.func,
  onSelect: PropTypes.func,
  excludeIds: PropTypes.arrayOf(idProp),
  disabled: PropTypes.bool,
  label: PropTypes.string,
  categoryFilter: PropTypes.oneOf(['venue', 'festival']),
}
