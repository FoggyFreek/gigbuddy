import { useTranslation } from 'react-i18next'
import { useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { getPlaceDetails, searchPlaces } from '../../people/venues/places.ts'
import useRemoteSearch from '../../hooks/useRemoteSearch.ts'
import type { PlaceSuggestion } from '../../types/api.ts'

interface PlaceSearchFieldProps {
  /** The typed text. Controlled: the field never holds its own copy. */
  value: string
  onValueChange: (value: string) => void
  /** Fired only when a real suggestion is picked, never for free-typed text. */
  onPlaceSelect: (suggestion: PlaceSuggestion) => void
  label: string
  placeholder?: string
  required?: boolean
  error?: boolean
  helperText?: string
  disabled?: boolean
  autoFocus?: boolean
  /** Optional bias point so nearby places rank first. Both values or neither. */
  biasLat?: number | null
  biasLon?: number | null
  /** Country the record is already known to be in — narrows the provider search. */
  country?: string | null
  /** City the record is already known to be in — narrows the provider search. */
  city?: string | null
}

// Reusable place lookup: an Autocomplete over the generic /api/places/search
// endpoint. Resource-agnostic — it emits a normalized PlaceSuggestion and lets
// the caller decide which fields to apply.
//
// freeSolo is deliberate: a name with no match must survive as typed so the user
// can fall back to manual entry, which is why the typed text is the value and
// onPlaceSelect only fires for object options.
export default function PlaceSearchField({
  value,
  onValueChange,
  onPlaceSelect,
  label,
  placeholder,
  required,
  error,
  helperText,
  disabled,
  autoFocus,
  biasLat = null,
  biasLon = null,
  country = null,
  city = null,
}: Readonly<PlaceSearchFieldProps>) {
  const { t, i18n } = useTranslation(['places', 'common'])
  const sessionId = useRef(crypto.randomUUID()).current
  const [resolving, setResolving] = useState(false)

  // useRemoteSearch owns the debounce, the 3-char minimum and stale-response
  // guarding — never add a second debounce on top of it.
  const { inputValue, options, loading, tooShort, minChars, onInputChange } = useRemoteSearch<PlaceSuggestion>({
    search: (query) => searchPlaces(query, {
      language: i18n.language, lat: biasLat, lon: biasLon, country, city, sessionId,
    }),
    inputValue: value,
    onInputValueChange: onValueChange,
    dependencyKey: `${i18n.language}:${biasLat ?? ''}:${biasLon ?? ''}:${country ?? ''}:${city ?? ''}`,
    enabled: !disabled,
  })

  // freeSolo suppresses MUI's noOptionsText/loadingText popper entirely, so the
  // search state has to surface as helper text under the field instead.
  function hintText() {
    if (disabled || !inputValue.trim()) return undefined
    if (tooShort) return t($ => $.search.typeMoreChars, { count: minChars })
    if (loading) return t($ => $.search.searching)
    if (!options.length) return t($ => $.search.noMatches)
    return undefined
  }

  async function handleChange(_event: SyntheticEvent, picked: PlaceSuggestion | string | null) {
    if (!picked) return
    // A raw string is the free-typed text; it is already the value.
    if (typeof picked === 'string') {
      onValueChange(picked)
      return
    }
    setResolving(true)
    try {
      onPlaceSelect(await getPlaceDetails(picked))
    } catch {
      // Suggestion fields still provide a useful manual-entry starting point.
      onPlaceSelect(picked)
    } finally {
      setResolving(false)
    }
  }

  return (
    <Autocomplete
      freeSolo
      value={value}
      onChange={handleChange}
      inputValue={inputValue}
      onInputChange={onInputChange}
      options={options}
      // The server already filtered — never re-filter client-side.
      filterOptions={(x) => x}
      loading={loading || resolving}
      disabled={disabled}
      clearText={t($ => $.search.clear)}
      openText={t($ => $.search.open)}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.name ?? '')}
      renderOption={(props, option) => {
        if (typeof option === 'string') {
          return <li {...props} key={option}><Typography variant="body2">{option}</Typography></li>
        }
        return (
          <li {...props} key={option.id ?? option.name}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2">{option.name}</Typography>
              {option.freeform_address && (
                <Typography variant="caption" color="text.secondary">
                  {option.freeform_address}
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
          required={required}
          autoFocus={autoFocus}
          placeholder={placeholder ?? t($ => $.search.placeholder)}
          error={error}
          helperText={helperText ?? hintText()}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps?.input,
              endAdornment: (
                <>
                  <InputAdornment position="end">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                  {(params.slotProps?.input as Record<string, unknown>)?.endAdornment as React.ReactNode}
                </>
              ),
            },
          }}
        />
      )}
    />
  )
}
