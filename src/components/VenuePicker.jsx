import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import VenueFormModal from './VenueFormModal.jsx'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

export default function VenuePicker({ value, onChange, disabled, label, categoryFilter }) {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [createPrefill, setCreatePrefill] = useState(null) // { name, category } | null
  const reqIdRef = useRef(0)

  const defaultLabel = categoryFilter === 'festival' ? 'Festival / event organisation' : 'Venue / physical location'
  const resolvedLabel = label ?? defaultLabel

  const trimmed = input.trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
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
          setOptions(rows)
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
  }, [trimmed, tooShort, categoryFilter])

  const augmentedOptions = useMemo(() => {
    if (tooShort || loading) return options
    if (options.length > 0) return options
    if (value) return options
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
  }, [options, tooShort, loading, trimmed, value, categoryFilter])

  function handleSelect(_event, picked) {
    if (!picked) {
      onChange(null)
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
    onChange(picked)
  }

  function handleCreated(venue) {
    setCreatePrefill(null)
    setInput('')
    setOptions([])
    onChange(venue)
  }

  return (
    <>
      <Autocomplete
        value={value}
        onChange={handleSelect}
        inputValue={input}
        onInputChange={(_e, v, reason) => {
          if (reason === 'input') setInput(v)
          else if (reason === 'reset') setInput(v)
          else if (reason === 'clear') setInput('')
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
          const extra = value?.id ? (
            <InputAdornment position="end" sx={{ m: 0, mr: -1 }}>
              <Tooltip title="Open venue">
                <IconButton
                  size="small"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/venues/${value.id}`)
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
        />
      )}
    </>
  )
}
