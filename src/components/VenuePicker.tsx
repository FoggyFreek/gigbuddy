import type { Venue, Id } from '../types/entities.ts'
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
import { searchVenues } from '../api/venues.ts'
import { venueHeadline, venueOptionLabel } from '../utils/venueDisplay.ts'
import VenueFormModal from './VenueFormModal.tsx'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

// A synthetic option for the "create venue/festival" action entries.
interface CreateAction {
  __action: string
  __label: string
}

type VenueOption = Venue | CreateAction

// `o` can be a raw string at runtime: MUI's freeSolo Autocomplete passes the
// typed text through as an option, so guard for a non-null object before `in`
// ('__action' in 'someString' throws).
function isCreateAction(o: unknown): o is CreateAction {
  return typeof o === 'object' && o !== null && '__action' in o
}

// Two modes:
//  - Bound field (default): controlled by value/onChange, used in gig flows.
//  - Add control: pass onSelect (and optionally excludeIds) to operate like
//    ContactPicker — value is forced null, each pick is reported via onSelect
//    and the input is cleared, and already-linked ids are filtered out of
//    results so a duplicate link can't be picked.

interface VenuePickerProps {
  value?: Venue | null
  onChange?: (venue: Venue | null) => void
  onSelect?: (venue: Venue) => void
  excludeIds?: Id[]
  disabled?: boolean
  label?: string
  categoryFilter?: 'venue' | 'festival'
}

export default function VenuePicker({ value, onChange, onSelect, excludeIds = [], disabled, label, categoryFilter }: VenuePickerProps) {
  const navigate = useNavigate()
  const [input, setInput] = useState('')   // what the field displays
  const [query, setQuery] = useState('')   // what we actually search on
  const [options, setOptions] = useState<Venue[]>([])
  const [loading, setLoading] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<{ name: string; category: string } | null>(null)
  const reqIdRef = useRef(0)

  const addMode = typeof onSelect === 'function'
  const effectiveValue = addMode ? null : (value ?? null)
  // Key the search effect on the exclude list's *contents*, not the array's
  // identity: callers (e.g. the gig flow) often rely on the default `[]`, which
  // is a fresh array each render.
  const excludeKey = excludeIds.join(',')

  const defaultLabel = categoryFilter === 'festival' ? 'Festival / event organisation' : 'Venue / physical location'
  const resolvedLabel = label ?? defaultLabel

  const trimmed = query.trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
    const excluded = new Set<Id>(excludeIds)
    const notExcluded = (r: Venue) => r.id !== undefined && !excluded.has(r.id)
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
        .then((rows: Venue[]) => {
          if (reqIdRef.current !== myReqId) return
          setOptions(rows.filter(notExcluded))
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

  const augmentedOptions: VenueOption[] = useMemo(() => {
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

  function report(venue: Venue) {
    if (addMode) {
      onSelect!(venue)
      setInput('')
      setQuery('')
      setOptions([])
    } else {
      onChange?.(venue)
    }
  }

  function handleSelect(_event: React.SyntheticEvent, picked: VenueOption | null) {
    if (!picked) {
      if (!addMode) onChange?.(null)
      return
    }
    if (isCreateAction(picked)) {
      if (picked.__action === 'create-venue') {
        setCreatePrefill({ name: trimmed, category: 'venue' })
      } else if (picked.__action === 'create-festival') {
        setCreatePrefill({ name: trimmed, category: 'festival' })
      }
      return
    }
    report(picked)
  }

  function handleCreated(venue: Venue) {
    setCreatePrefill(null)
    setInput('')
    setQuery('')
    setOptions([])
    if (categoryFilter && venue.category !== categoryFilter) return
    report(venue)
  }

  let noOptionsText: string
  if (tooShort) {
    noOptionsText = `Type at least ${MIN_CHARS} characters…`
  } else if (loading) {
    noOptionsText = 'Searching…'
  } else {
    noOptionsText = 'No matches'
  }

  return (
    <>
      <Autocomplete
        value={effectiveValue}
        onChange={handleSelect}
        inputValue={input}
        onInputChange={(_e, v, reason) => {
          if (reason === 'input') { setInput(v); setQuery(v) }
          else if (reason === 'reset') setInput(v)
          else if (reason === 'clear') { setInput(''); setQuery('') }
        }}
        options={augmentedOptions}
        filterOptions={(x) => x}
        loading={loading}
        disabled={disabled}
        getOptionLabel={(o: VenueOption) =>
          isCreateAction(o) ? o.__label : venueOptionLabel(o)
        }
        isOptionEqualToValue={(a: VenueOption, b: VenueOption) => {
          if (isCreateAction(a) || isCreateAction(b)) return false
          return a?.id != null && a.id === b?.id
        }}
        noOptionsText={noOptionsText}
        renderOption={(props, option: VenueOption) => {
          if (isCreateAction(option)) {
            return (
              <li {...props} key={option.__action}>
                <Typography variant="body2" color="primary">{option.__label}</Typography>
              </li>
            )
          }
          const subtitle = [option.city, option.region, option.country].filter(Boolean).join(', ')
          return (
            <li {...props} key={String(option.id)}>
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
          const inputSlotProps = (params.slotProps?.input ?? ((params as unknown) as Record<string, unknown>).InputProps ?? {}) as Record<string, unknown>
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
                      {inputSlotProps.endAdornment as React.ReactNode}
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
