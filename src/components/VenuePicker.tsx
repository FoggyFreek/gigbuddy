import type { Venue, Id } from '../types/entities.ts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import useRemoteSearch from '../hooks/useRemoteSearch.ts'
import { venueHeadline, venueOptionLabel } from '../utils/venueDisplay.ts'
import VenueFormModal from './VenueFormModal.tsx'

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

export default function VenuePicker({ value, onChange, onSelect, excludeIds = [], disabled, label, categoryFilter }: Readonly<VenuePickerProps>) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const [createPrefill, setCreatePrefill] = useState<{ name: string; category: string } | null>(null)

  const addMode = typeof onSelect === 'function'
  const effectiveValue = addMode ? null : (value ?? null)
  // Key the search effect on the exclude list's *contents*, not the array's
  // identity: callers (e.g. the gig flow) often rely on the default `[]`, which
  // is a fresh array each render.
  const excludeKey = excludeIds.join(',')

  const defaultLabel = categoryFilter === 'festival'
    ? t($ => $.venuePicker.labelFestival)
    : t($ => $.venuePicker.labelVenue)
  const resolvedLabel = label ?? defaultLabel

  const {
    inputValue, query, options, loading, tooShort, minChars, onInputChange, clear,
  } = useRemoteSearch<Venue>({
    search: (searchQuery) => searchVenues(searchQuery, categoryFilter),
    dependencyKey: `${categoryFilter ?? ''}:${excludeKey}`,
    filterResults: (rows) => {
      const excluded = new Set<Id>(excludeIds)
      return rows.filter((row) => row.id !== undefined && !excluded.has(row.id))
    },
  })

  const augmentedOptions: VenueOption[] = useMemo(() => {
    if (tooShort || loading) return options
    if (options.length > 0) return options
    if (effectiveValue) return options
    const createVenue = { __action: 'create-venue', __label: t($ => $.venuePicker.createVenue, { name: query }) }
    const createFestival = { __action: 'create-festival', __label: t($ => $.venuePicker.createFestival, { name: query }) }
    if (categoryFilter === 'festival') return [createFestival]
    if (categoryFilter === 'venue') return [createVenue]
    return [createVenue, createFestival]
  }, [options, tooShort, loading, query, effectiveValue, categoryFilter, t])

  function report(venue: Venue) {
    if (addMode) {
      onSelect!(venue)
      clear()
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
        setCreatePrefill({ name: query, category: 'venue' })
      } else if (picked.__action === 'create-festival') {
        setCreatePrefill({ name: query, category: 'festival' })
      }
      return
    }
    report(picked)
  }

  function handleCreated(venue: Venue) {
    setCreatePrefill(null)
    clear()
    if (categoryFilter && venue.category !== categoryFilter) return
    report(venue)
  }

  let noOptionsText: string
  if (tooShort) {
    noOptionsText = t($ => $.picker.typeMinChars, { count: minChars })
  } else if (loading) {
    noOptionsText = t($ => $.picker.searching)
  } else {
    noOptionsText = t($ => $.picker.noMatches)
  }

  return (
    <>
      <Autocomplete
        value={effectiveValue}
        onChange={handleSelect}
        inputValue={inputValue}
        onInputChange={onInputChange}
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
                {option.category === 'festival' ? t($ => $.venuePicker.categoryFestival) : t($ => $.venuePicker.categoryVenue)}
              </Typography>
            </li>
          )
        }}
        renderInput={(params) => {
          const extra = effectiveValue?.id ? (
            <InputAdornment position="end" sx={{ m: 0, mr: -1 }}>
              <Tooltip title={t($ => $.venuePicker.openVenue)}>
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
